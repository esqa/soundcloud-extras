// ==UserScript==
// @name         SoundCloud Extras
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Right-click to save artwork or download tracks from SoundCloud
// @author       esqa
// @match        https://soundcloud.com/*
// @grant        GM_download
// @grant        GM_addElement
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      sndcdn.com
// @connect      api-v2.soundcloud.com
// @connect      soundcloud.cloud
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let contextMenu = null;
    let targetImage = null;
    let imageType = 'artwork'; // 'artwork' or 'avatar'
    let targetElement = null; // Store the element that was clicked

    // ── Batch download cancellation ──
    let batchCancelled = false;

    // ── Intercepted credentials ──
    let interceptedClientId = null;
    let interceptedOAuthToken = null;

    // ── XHR Interception: capture client_id from SoundCloud's own API calls ──
    (function hookXHR() {
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            try {
                if (typeof url === 'string' && url.includes('api-v2.soundcloud.com')) {
                    const u = new URL(url, location.origin);
                    const cid = u.searchParams.get('client_id');
                    if (cid && cid.length > 10) {
                        interceptedClientId = cid;
                        GM_setValue('sc_client_id', cid);
                        GM_setValue('sc_client_id_ts', Date.now());
                    }
                }
            } catch (_) { /* ignore parse errors */ }
            return origOpen.apply(this, arguments);
        };

        // Also hook fetch
        const origFetch = window.fetch;
        window.fetch = function(input) {
            try {
                const url = typeof input === 'string' ? input : input?.url;
                if (url && url.includes('api-v2.soundcloud.com')) {
                    const u = new URL(url, location.origin);
                    const cid = u.searchParams.get('client_id');
                    if (cid && cid.length > 10) {
                        interceptedClientId = cid;
                        GM_setValue('sc_client_id', cid);
                        GM_setValue('sc_client_id_ts', Date.now());
                    }
                }
            } catch (_) { /* ignore */ }
            return origFetch.apply(this, arguments);
        };
    })();

    // ── Utility: Promise wrapper for GM_xmlhttpRequest ──
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                responseType: options.responseType || 'text',
                onload: function(resp) {
                    if (resp.status >= 200 && resp.status < 400) {
                        resolve(resp);
                    } else {
                        reject({ status: resp.status, response: resp });
                    }
                },
                onerror: function(err) {
                    reject(err);
                }
            });
        });
    }

    // ── Notification toast with progress bar ──
    function createNotification(message) {
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #333;
            color: white;
            padding: 12px 18px 16px;
            border-radius: 6px;
            z-index: 10001;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-width: 250px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        const text = document.createElement('div');
        text.textContent = message;
        text.style.marginBottom = '8px';
        container.appendChild(text);

        const progressBg = document.createElement('div');
        progressBg.style.cssText = `
            width: 100%;
            height: 4px;
            background: #555;
            border-radius: 2px;
            overflow: hidden;
        `;
        const progressFill = document.createElement('div');
        progressFill.style.cssText = `
            width: 0%;
            height: 100%;
            background: #f50;
            border-radius: 2px;
            transition: width 0.15s ease;
        `;
        progressBg.appendChild(progressFill);
        container.appendChild(progressBg);

        document.body.appendChild(container);

        return {
            el: container,
            setText(msg) { text.textContent = msg; },
            setProgress(pct) { progressFill.style.width = Math.min(100, Math.max(0, pct)) + '%'; },
            remove() { container.remove(); }
        };
    }

    // ── Client ID extraction ──
    async function getClientId() {
        // 1. Already intercepted from live XHR/fetch
        if (interceptedClientId) {
            return interceptedClientId;
        }

        // 2. Cached value (less than 1 hour old)
        const cached = GM_getValue('sc_client_id', null);
        const cachedTs = GM_getValue('sc_client_id_ts', 0);
        if (cached && (Date.now() - cachedTs) < 3600000) {
            interceptedClientId = cached;
            return cached;
        }

        // 3. __sc_hydration
        try {
            if (window.__sc_hydration) {
                for (const item of window.__sc_hydration) {
                    if (item?.hydratable === 'anonymousId' && item.data) {
                        interceptedClientId = item.data;
                        GM_setValue('sc_client_id', item.data);
                        GM_setValue('sc_client_id_ts', Date.now());
                        return item.data;
                    }
                }
            }
        } catch (_) {}

        // 4. Inline script tags
        try {
            for (const script of document.querySelectorAll('script')) {
                if (script.textContent?.includes('client_id')) {
                    const m = script.textContent.match(/["']client_id["']\s*:\s*["']([a-zA-Z0-9]+)["']/);
                    if (m) {
                        interceptedClientId = m[1];
                        GM_setValue('sc_client_id', m[1]);
                        GM_setValue('sc_client_id_ts', Date.now());
                        return m[1];
                    }
                }
            }
        } catch (_) {}

        // 5. Search ALL sndcdn.com script bundles (not just 49-)
        try {
            const scripts = Array.from(document.querySelectorAll('script[src*="sndcdn.com"]'));
            for (const s of scripts) {
                try {
                    const resp = await gmFetch(s.src);
                    const m = resp.responseText.match(/client_id[:=]["']([a-zA-Z0-9]{20,})['"]/);
                    if (m) {
                        interceptedClientId = m[1];
                        GM_setValue('sc_client_id', m[1]);
                        GM_setValue('sc_client_id_ts', Date.now());
                        return m[1];
                    }
                } catch (_) {}
            }
        } catch (_) {}

        return null;
    }

    // ── OAuth token extraction ──
    function getOAuthToken() {
        if (interceptedOAuthToken) return interceptedOAuthToken;
        try {
            if (window.__sc_hydration) {
                for (const item of window.__sc_hydration) {
                    if (item?.hydratable === 'user' && item.data?.oauth_token) {
                        interceptedOAuthToken = item.data.oauth_token;
                        return interceptedOAuthToken;
                    }
                }
            }
        } catch (_) {}
        return null;
    }

    // ── Build auth headers ──
    function buildHeaders() {
        const headers = {
            'Accept': 'application/json',
            'Origin': 'https://soundcloud.com',
            'Referer': 'https://soundcloud.com/'
        };
        const token = getOAuthToken();
        if (token) {
            headers['Authorization'] = `OAuth ${token}`;
        }
        return headers;
    }

    // ── HLS download: fetch m3u8, download all segments, concatenate ──
    async function downloadHLS(transcodingUrl, clientId, trackAuth, filename, ext, notification) {
        const headers = buildHeaders();

        // Step 1: Resolve transcoding URL → get m3u8 URL
        let resolveParams = `?client_id=${clientId}`;
        if (trackAuth) resolveParams += `&track_authorization=${trackAuth}`;

        notification.setText('Resolving stream URL...');
        const streamResp = await gmFetch(transcodingUrl + resolveParams, { headers });
        const streamData = JSON.parse(streamResp.responseText);
        if (!streamData.url) throw new Error('No stream URL returned');

        // Step 2: Fetch m3u8 playlist
        notification.setText('Fetching playlist...');
        const m3u8Resp = await gmFetch(streamData.url);
        let m3u8Text = m3u8Resp.responseText;
        let m3u8BaseUrl = streamData.url.substring(0, streamData.url.lastIndexOf('/') + 1);

        // Step 3: If master playlist, follow to media playlist
        if (m3u8Text.includes('#EXT-X-STREAM-INF')) {
            const lines = m3u8Text.split('\n');
            let mediaPlaylistUrl = null;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    const nextLine = lines[i + 1]?.trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        mediaPlaylistUrl = nextLine.startsWith('http')
                            ? nextLine
                            : m3u8BaseUrl + nextLine;
                        break;
                    }
                }
            }
            if (!mediaPlaylistUrl) throw new Error('Could not find media playlist in master m3u8');

            const mediaResp = await gmFetch(mediaPlaylistUrl);
            m3u8Text = mediaResp.responseText;
            m3u8BaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf('/') + 1);
        }

        // Step 4: Parse init segment and media segments
        const lines = m3u8Text.split('\n');
        let initSegmentUrl = null;
        const segmentUrls = [];

        for (const line of lines) {
            const trimmed = line.trim();

            // Init segment (fMP4)
            if (trimmed.startsWith('#EXT-X-MAP:')) {
                const uriMatch = trimmed.match(/URI="([^"]+)"/);
                if (uriMatch) {
                    initSegmentUrl = uriMatch[1].startsWith('http')
                        ? uriMatch[1]
                        : m3u8BaseUrl + uriMatch[1];
                }
            }

            // Media segments: non-comment, non-empty lines
            if (trimmed && !trimmed.startsWith('#')) {
                const segUrl = trimmed.startsWith('http')
                    ? trimmed
                    : m3u8BaseUrl + trimmed;
                segmentUrls.push(segUrl);
            }
        }

        if (segmentUrls.length === 0) throw new Error('No media segments found in playlist');

        // Step 5: Download all segments
        const allUrls = [];
        if (initSegmentUrl) allUrls.push(initSegmentUrl);
        allUrls.push(...segmentUrls);

        const totalSegments = allUrls.length;
        const buffers = [];

        notification.setText(`Downloading... (0/${totalSegments})`);
        notification.setProgress(0);

        for (let i = 0; i < allUrls.length; i++) {
            const resp = await gmFetch(allUrls[i], { responseType: 'arraybuffer' });
            buffers.push(new Uint8Array(resp.response));
            const pct = Math.round(((i + 1) / totalSegments) * 100);
            notification.setText(`Downloading... (${i + 1}/${totalSegments})`);
            notification.setProgress(pct);
        }

        // Step 6: Concatenate all segments
        notification.setText('Assembling file...');
        const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const buf of buffers) {
            merged.set(buf, offset);
            offset += buf.length;
        }

        // Step 7: Return blob and filename for caller to handle
        const blob = new Blob([merged], {
            type: ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg'
        });
        return { blob, filename: filename + ext };
    }

    // ── Build a ZIP file from an array of { name, data (ArrayBuffer) } ──
    function buildZip(files) {
        const crcTable = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            crcTable[i] = c;
        }

        function crc32(data) {
            const bytes = new Uint8Array(data);
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < bytes.length; i++) {
                crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            }
            return (crc ^ 0xFFFFFFFF) >>> 0;
        }

        const encoder = new TextEncoder();
        const entries = [];
        let offset = 0;

        for (const file of files) {
            const nameBytes = encoder.encode(file.name);
            const fileData = new Uint8Array(file.data);
            const crc = crc32(fileData);

            // Local file header
            const local = new ArrayBuffer(30 + nameBytes.length);
            const lv = new DataView(local);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint16(8, 0, true); // STORE
            lv.setUint32(14, crc, true);
            lv.setUint32(18, fileData.length, true);
            lv.setUint32(22, fileData.length, true);
            lv.setUint16(26, nameBytes.length, true);
            new Uint8Array(local).set(nameBytes, 30);

            // Central directory header
            const central = new ArrayBuffer(46 + nameBytes.length);
            const cv = new DataView(central);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(10, 0, true); // STORE
            cv.setUint32(16, crc, true);
            cv.setUint32(20, fileData.length, true);
            cv.setUint32(24, fileData.length, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint32(42, offset, true);
            new Uint8Array(central).set(nameBytes, 46);

            entries.push({ local, data: fileData, central });
            offset += 30 + nameBytes.length + fileData.length;
        }

        const centralDirOffset = offset;
        let centralDirSize = 0;
        for (const e of entries) centralDirSize += e.central.byteLength;

        const eocd = new ArrayBuffer(22);
        const ev = new DataView(eocd);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralDirSize, true);
        ev.setUint32(16, centralDirOffset, true);

        const result = new Uint8Array(offset + centralDirSize + 22);
        let pos = 0;
        for (const e of entries) {
            result.set(new Uint8Array(e.local), pos);
            pos += e.local.byteLength;
            result.set(e.data, pos);
            pos += e.data.length;
        }
        for (const e of entries) {
            result.set(new Uint8Array(e.central), pos);
            pos += e.central.byteLength;
        }
        result.set(new Uint8Array(eocd), pos);

        return new Blob([result], { type: 'application/zip' });
    }

    // ── Trigger a blob download via <a> click ──
    function triggerBlobDownload(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }

    // ── Create custom context menu ──
    function createContextMenu() {
        const menu = document.createElement('div');
        menu.id = 'sc-save-artwork-menu';
        menu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 4px 0;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2);
            z-index: 10000;
            display: none;
        `;

        document.body.appendChild(menu);
        return menu;
    }

    // Create menu item
    function createMenuItem(text, onClick) {
        const menuItem = document.createElement('div');
        menuItem.textContent = text;
        menuItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            color: #333;
        `;
        menuItem.onmouseover = () => menuItem.style.backgroundColor = '#f0f0f0';
        menuItem.onmouseout = () => menuItem.style.backgroundColor = 'transparent';
        menuItem.onclick = onClick;
        return menuItem;
    }

    // Extract high-res artwork URL
    function getHighResUrl(url) {
        return url.replace(/-t\d+x\d+/, '-t500x500');
    }

    // Clean filename - remove multiple underscores and trim
    function cleanFilename(str) {
        return str.replace(/[^a-z0-9]/gi, '_')
                  .replace(/_+/g, '_')
                  .replace(/^_|_$/g, '')
                  .toLowerCase();
    }

    // Get track info from current context
    function getTrackInfo() {
        let trackTitle = null;
        let artistName = null;

        if (targetElement?.getAttribute('aria-label')) {
            trackTitle = targetElement.getAttribute('aria-label').trim();
        }

        const isPlaybackBar = targetElement?.closest('.playbackSoundBadge, .playControls');

        if (!trackTitle && isPlaybackBar) {
            trackTitle = document.querySelector('.playbackSoundBadge__title span[aria-hidden="true"]')?.textContent?.trim() ||
                       document.querySelector('.playbackSoundBadge__titleLink')?.textContent?.trim();
            artistName = document.querySelector('.playbackSoundBadge__lightLink')?.textContent?.trim();
        } else if (!trackTitle && window.location.pathname.includes('/') && window.location.pathname.split('/').length === 3) {
            trackTitle = document.querySelector('.soundTitle__title')?.textContent?.trim() ||
                       document.querySelector('h1[itemprop="name"]')?.textContent?.trim() ||
                       document.querySelector('.fullHero__title')?.textContent?.trim();
            artistName = document.querySelector('.soundTitle__username')?.textContent?.trim() ||
                        document.querySelector('.soundTitle__usernameText')?.textContent?.trim();
        }

        if (!trackTitle) {
            const soundItem = targetElement?.closest('.sound__body, .soundList__item, .trackItem, .searchItem, .soundBadge, .userStreamItem, .playableTile, .soundStreamContent');
            if (soundItem) {
                const artwork = soundItem.querySelector('.sc-artwork[aria-label], .playableTile__artwork[aria-label]');
                if (artwork) {
                    trackTitle = artwork.getAttribute('aria-label').trim();
                } else {
                    trackTitle = soundItem.querySelector('.soundTitle__title span:not(.soundTitle__usernameText)')?.textContent?.trim() ||
                               soundItem.querySelector('.soundTitle__title')?.textContent?.trim() ||
                               soundItem.querySelector('.trackItem__trackTitle')?.textContent?.trim() ||
                               soundItem.querySelector('.soundTitle__titleContainer a')?.textContent?.trim() ||
                               soundItem.querySelector('a.soundTitle__title')?.textContent?.trim() ||
                               soundItem.querySelector('.playableTile__mainHeading')?.textContent?.trim() ||
                               soundItem.querySelector('.playableTile__heading a')?.textContent?.trim() ||
                               soundItem.querySelector('a[href*="/"][href*="-"]:not(.soundTitle__username):not(.playableTile__usernameLink)')?.textContent?.trim();
                }
                artistName = soundItem.querySelector('.soundTitle__username')?.textContent?.trim() ||
                           soundItem.querySelector('.soundTitle__usernameText')?.textContent?.trim() ||
                           soundItem.querySelector('.playableTile__username')?.textContent?.trim() ||
                           soundItem.querySelector('.playableTile__usernameLink')?.textContent?.trim();
            }
        }

        if (!trackTitle) {
            trackTitle = document.querySelector('.playbackSoundBadge__title span[aria-hidden="true"]')?.textContent ||
                        document.querySelector('.soundTitle__title span')?.textContent;
            artistName = document.querySelector('.playbackSoundBadge__lightLink')?.textContent?.trim();
        }

        return { trackTitle, artistName };
    }

    // Save the artwork
    function saveArtwork() {
        if (!targetImage) return;

        const imageUrl = getHighResUrl(targetImage);
        let filename = 'soundcloud-image.jpg';

        if (imageType === 'avatar') {
            let username = document.querySelector('.profileHeaderInfo__userName')?.textContent?.trim() ||
                          document.querySelector('.userBadge__username')?.textContent?.trim() ||
                          targetImage.match(/avatars-[^/]+-(\w+)-/)?.[1] ||
                          'avatar';
            username = username.replace(/\s+/g, ' ').trim();
            filename = cleanFilename(username) + '-avatar.jpg';
        } else {
            const { trackTitle } = getTrackInfo();
            if (trackTitle) {
                filename = cleanFilename(trackTitle) + '.jpg';
            }
        }

        GM_download({
            url: imageUrl,
            name: filename,
            onerror: function(error) {
                console.error('Download failed:', error);
                alert('Failed to download artwork. Please try again.');
            }
        });

        hideContextMenu();
    }

    // ── Extract track URL from clicked context ──
    function extractTrackUrl() {
        let trackUrl = null;

        const soundItem = targetElement?.closest('.sound__body, .soundList__item, .trackItem, .searchItem, .soundBadge, .userStreamItem, .playableTile, .soundStreamContent');
        if (soundItem) {
            const trackLink = soundItem.querySelector('a.soundTitle__title, a.playableTile__mainHeading, a.soundTitle__titleLink, a[href*="/"][href*="-"]:not(.soundTitle__username):not(.soundTitle__usernameLink)') ||
                            soundItem.querySelector('.trackItem__trackTitle a') ||
                            soundItem.querySelector('.soundTitle__titleContainer a');
            if (trackLink?.href) {
                trackUrl = trackLink.href;
            }
        }

        if (!trackUrl && targetElement?.closest('.playbackSoundBadge, .playControls')) {
            const playbackLink = document.querySelector('.playbackSoundBadge__titleLink');
            if (playbackLink?.href) {
                trackUrl = playbackLink.href;
            }
        }

        if (!trackUrl && window.location.pathname.includes('/') && window.location.pathname.split('/').length === 3) {
            trackUrl = window.location.href;
        }

        return trackUrl;
    }

    // ── Download a single track from already-resolved track data ──
    async function downloadTrackData(trackData, clientId, notification) {
        const media = trackData.media || trackData.track?.media;
        const trackAuth = trackData.track_authorization || trackData.track?.track_authorization || null;
        const title = trackData.title || 'Unknown';
        const artist = trackData.user?.username || '';
        const baseName = cleanFilename(artist ? `${artist} - ${title}` : title);

        if (!media?.transcodings || media.transcodings.length === 0) {
            throw new Error('No media transcodings found');
        }

        console.log('[SC Extras] Available transcodings:', media.transcodings.map(t =>
            `${t.format.protocol}/${t.format.mime_type} — ${t.preset} — ${t.quality}`
        ));

        const headers = buildHeaders();

        // Priority order:
        const progressive = media.transcodings.find(t =>
            t.format.protocol === 'progressive' && t.format.mime_type === 'audio/mpeg'
        );
        const hlsAac160 = media.transcodings.find(t =>
            t.format.protocol === 'hls' &&
            (t.format.mime_type === 'audio/mp4' || t.format.mime_type.includes('mp4')) &&
            (t.preset?.includes('aac_160') || t.quality === 'hq')
        );
        const hlsAacAny = media.transcodings.find(t =>
            t.format.protocol === 'hls' &&
            (t.format.mime_type === 'audio/mp4' || t.format.mime_type.includes('mp4'))
        );
        const hlsMp3 = media.transcodings.find(t =>
            t.format.protocol === 'hls' && t.format.mime_type === 'audio/mpeg'
        );

        if (progressive?.url) {
            notification.setText('Fetching stream URL...');
            let streamUrl = progressive.url + `?client_id=${clientId}`;
            if (trackAuth) streamUrl += `&track_authorization=${trackAuth}`;

            const streamResp = await gmFetch(streamUrl, { headers });
            const streamData = JSON.parse(streamResp.responseText);
            if (!streamData.url) throw new Error('Progressive stream URL not found');

            notification.setText('Downloading MP3...');
            notification.setProgress(50);

            const mp3Resp = await gmFetch(streamData.url, { responseType: 'arraybuffer' });
            const blob = new Blob([mp3Resp.response], { type: 'audio/mpeg' });

            notification.setText('Download complete!');
            notification.setProgress(100);

            return { blob, filename: baseName + '.mp3' };

        } else if (hlsAac160?.url) {
            return await downloadHLS(hlsAac160.url, clientId, trackAuth, baseName, '.m4a', notification);

        } else if (hlsAacAny?.url) {
            return await downloadHLS(hlsAacAny.url, clientId, trackAuth, baseName, '.m4a', notification);

        } else if (hlsMp3?.url) {
            return await downloadHLS(hlsMp3.url, clientId, trackAuth, baseName, '.mp3', notification);

        } else {
            throw new Error('No supported stream format found');
        }
    }

    // ── Main download function (async/await) ──
    async function downloadSong() {
        const { trackTitle, artistName } = getTrackInfo();

        if (!trackTitle) {
            alert('Could not find track information. Please try again.');
            hideContextMenu();
            return;
        }

        const trackUrl = extractTrackUrl();
        if (!trackUrl) {
            alert('Could not find track URL. Please try clicking on the track artwork.');
            hideContextMenu();
            return;
        }

        hideContextMenu();

        const notification = createNotification('Fetching track data...');

        try {
            let clientId = await getClientId();
            if (!clientId) {
                notification.remove();
                alert('Could not find SoundCloud client ID. Please play any track first to let the page make an API request, then try again.');
                return;
            }

            const headers = buildHeaders();

            let resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}`;
            let trackData;

            try {
                const resp = await gmFetch(resolveUrl, { headers });
                trackData = JSON.parse(resp.responseText);
            } catch (err) {
                if (err?.status === 401 || err?.status === 403) {
                    notification.setText('Auth failed, retrying...');
                    interceptedClientId = null;
                    GM_setValue('sc_client_id', '');
                    GM_setValue('sc_client_id_ts', 0);

                    clientId = await getClientId();
                    if (!clientId) throw new Error('Could not obtain a valid client ID');

                    resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${clientId}`;
                    const resp2 = await gmFetch(resolveUrl, { headers: buildHeaders() });
                    trackData = JSON.parse(resp2.responseText);
                } else {
                    throw err;
                }
            }

            if (!trackData) throw new Error('Track data not found');

            const { blob, filename } = await downloadTrackData(trackData, clientId, notification);
            triggerBlobDownload(blob, filename);
            notification.setText('Download complete!');
            notification.setProgress(100);
            setTimeout(() => notification.remove(), 2500);

        } catch (error) {
            console.error('[SC Extras] Download error:', error);
            notification.setText('Download failed');
            setTimeout(() => notification.remove(), 3000);
            alert('Failed to download: ' + (error.message || 'Unknown error'));
        }
    }

    // ── Batch download: create notification with cancel link ──
    function createBatchNotification(message) {
        const notification = createNotification(message);
        const textDiv = notification.el.firstChild;

        const cancelLink = document.createElement('span');
        cancelLink.textContent = '[Cancel]';
        cancelLink.style.cssText = `
            color: #f50;
            cursor: pointer;
            margin-left: 10px;
            font-size: 12px;
        `;
        cancelLink.onclick = () => { batchCancelled = true; };
        textDiv.appendChild(cancelLink);

        const origSetText = notification.setText;
        notification.setText = function(msg) {
            origSetText(msg);
            textDiv.appendChild(cancelLink);
        };

        return notification;
    }

    // ── Download an entire playlist ──
    async function downloadPlaylist() {
        hideContextMenu();
        batchCancelled = false;

        const notification = createBatchNotification('Resolving playlist...');

        try {
            let clientId = await getClientId();
            if (!clientId) {
                notification.remove();
                alert('Could not find SoundCloud client ID. Please play any track first, then try again.');
                return;
            }

            const headers = buildHeaders();
            const pageUrl = window.location.href.split('?')[0];

            // Resolve playlist
            const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(pageUrl)}&client_id=${clientId}`;
            const resp = await gmFetch(resolveUrl, { headers });
            const playlist = JSON.parse(resp.responseText);

            if (!playlist.tracks || playlist.tracks.length === 0) {
                throw new Error('No tracks found in playlist');
            }

            const totalTracks = playlist.tracks.length;

            // SoundCloud returns partial track objects for large playlists — fetch full data in batches of 50
            const needsFull = playlist.tracks.some(t => !t.media);
            let fullTracks = playlist.tracks;

            if (needsFull) {
                notification.setText('Fetching full track data...');
                fullTracks = [];
                const ids = playlist.tracks.map(t => t.id);
                for (let i = 0; i < ids.length; i += 50) {
                    const batch = ids.slice(i, i + 50);
                    const batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join(',')}&client_id=${clientId}`;
                    const batchResp = await gmFetch(batchUrl, { headers });
                    const batchData = JSON.parse(batchResp.responseText);
                    fullTracks.push(...batchData);
                }
            }

            const zipFiles = [];
            let downloaded = 0;

            for (let i = 0; i < fullTracks.length; i++) {
                if (batchCancelled) {
                    break;
                }

                const track = fullTracks[i];
                const trackName = track.title || `Track ${i + 1}`;
                notification.setText(`Downloading playlist: ${i + 1}/${totalTracks} — ${trackName}`);
                notification.setProgress(Math.round(((i) / totalTracks) * 100));

                try {
                    const { blob, filename } = await downloadTrackData(track, clientId, notification);
                    zipFiles.push({ name: filename, data: await blob.arrayBuffer() });
                    downloaded++;
                } catch (err) {
                    console.error(`[SC Extras] Failed to download "${trackName}":`, err);
                }

                // Delay between tracks to avoid rate limiting
                if (i < fullTracks.length - 1) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            if (downloaded === 0) {
                notification.setText('No tracks could be downloaded');
                setTimeout(() => notification.remove(), 3000);
                return;
            }

            notification.setText('Creating ZIP file...');
            notification.setProgress(95);

            const playlistName = cleanFilename(playlist.title || 'playlist');
            const zipBlob = buildZip(zipFiles);
            triggerBlobDownload(zipBlob, playlistName + '.zip');

            const label = batchCancelled ? 'Cancelled' : 'Playlist complete';
            notification.setText(`${label}: ${downloaded}/${totalTracks} tracks zipped`);
            notification.setProgress(100);
            setTimeout(() => notification.remove(), 4000);

        } catch (error) {
            console.error('[SC Extras] Playlist download error:', error);
            notification.setText('Playlist download failed');
            setTimeout(() => notification.remove(), 3000);
            alert('Failed to download playlist: ' + (error.message || 'Unknown error'));
        }
    }

    // ── Download all liked tracks ──
    async function downloadLikes() {
        hideContextMenu();
        batchCancelled = false;

        const notification = createBatchNotification('Fetching likes...');

        try {
            let clientId = await getClientId();
            if (!clientId) {
                notification.remove();
                alert('Could not find SoundCloud client ID. Please play any track first, then try again.');
                return;
            }

            const headers = buildHeaders();

            // Get user ID from hydration or by resolving the page URL
            let userId = null;
            try {
                if (window.__sc_hydration) {
                    for (const item of window.__sc_hydration) {
                        if (item?.hydratable === 'user' && item.data?.id) {
                            userId = item.data.id;
                            break;
                        }
                    }
                }
            } catch (_) {}

            if (!userId) {
                // Resolve the user profile URL (strip /likes)
                const userUrl = window.location.href.replace(/\/likes\/?$/, '');
                const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(userUrl)}&client_id=${clientId}`;
                const resp = await gmFetch(resolveUrl, { headers });
                const userData = JSON.parse(resp.responseText);
                userId = userData.id;
            }

            if (!userId) throw new Error('Could not determine user ID');

            // Paginate likes
            notification.setText('Fetching liked tracks...');
            const allTracks = [];
            let nextHref = `https://api-v2.soundcloud.com/users/${userId}/likes?client_id=${clientId}&limit=200&offset=0`;

            while (nextHref) {
                if (batchCancelled) break;

                // Ensure client_id is in the URL
                if (!nextHref.includes('client_id=')) {
                    nextHref += (nextHref.includes('?') ? '&' : '?') + `client_id=${clientId}`;
                }

                const resp = await gmFetch(nextHref, { headers });
                const data = JSON.parse(resp.responseText);

                if (data.collection) {
                    for (const item of data.collection) {
                        if (item.track) {
                            allTracks.push(item.track);
                        }
                    }
                }

                notification.setText(`Fetching liked tracks... (${allTracks.length} found)`);
                nextHref = data.next_href || null;
            }

            if (allTracks.length === 0) {
                notification.setText('No liked tracks found');
                setTimeout(() => notification.remove(), 3000);
                return;
            }

            const totalTracks = allTracks.length;

            // Fetch full track data for tracks missing media info
            const incompleteTracks = allTracks.filter(t => !t.media);
            if (incompleteTracks.length > 0) {
                notification.setText('Fetching full track data...');
                const ids = incompleteTracks.map(t => t.id);
                const fullMap = new Map();
                for (let i = 0; i < ids.length; i += 50) {
                    const batch = ids.slice(i, i + 50);
                    const batchUrl = `https://api-v2.soundcloud.com/tracks?ids=${batch.join(',')}&client_id=${clientId}`;
                    const batchResp = await gmFetch(batchUrl, { headers });
                    const batchData = JSON.parse(batchResp.responseText);
                    for (const t of batchData) {
                        fullMap.set(t.id, t);
                    }
                }
                for (let i = 0; i < allTracks.length; i++) {
                    if (!allTracks[i].media && fullMap.has(allTracks[i].id)) {
                        allTracks[i] = fullMap.get(allTracks[i].id);
                    }
                }
            }

            const zip = new JSZip();
            let downloaded = 0;

            for (let i = 0; i < allTracks.length; i++) {
                if (batchCancelled) {
                    break;
                }

                const track = allTracks[i];
                const trackName = track.title || `Track ${i + 1}`;
                notification.setText(`Downloading likes: ${i + 1}/${totalTracks} — ${trackName}`);
                notification.setProgress(Math.round(((i) / totalTracks) * 100));

                try {
                    const { blob, filename } = await downloadTrackData(track, clientId, notification);
                    zip.file(filename, await blob.arrayBuffer());
                    downloaded++;
                } catch (err) {
                    console.error(`[SC Extras] Failed to download "${trackName}":`, err);
                }

                if (i < allTracks.length - 1) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            if (downloaded === 0) {
                notification.setText('No tracks could be downloaded');
                setTimeout(() => notification.remove(), 3000);
                return;
            }

            notification.setText('Creating ZIP file...');
            notification.setProgress(95);

            // Extract username from the page URL
            const username = cleanFilename(window.location.pathname.replace(/\/likes\/?$/, '').replace(/^\//, '') || 'likes');
            const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            triggerBlobDownload(zipBlob, username + '-likes.zip');

            const label = batchCancelled ? 'Cancelled' : 'Likes complete';
            notification.setText(`${label}: ${downloaded}/${totalTracks} tracks zipped`);
            notification.setProgress(100);
            setTimeout(() => notification.remove(), 4000);

        } catch (error) {
            console.error('[SC Extras] Likes download error:', error);
            notification.setText('Likes download failed');
            setTimeout(() => notification.remove(), 3000);
            alert('Failed to download likes: ' + (error.message || 'Unknown error'));
        }
    }

    // Hide context menu
    function hideContextMenu() {
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
        targetImage = null;
        imageType = 'artwork';
        targetElement = null;
    }

    // Check if element is SoundCloud image (artwork or avatar)
    function isSoundCloudImage(element) {
        if (!element) return false;

        if (element.tagName === 'IMG') {
            return element.src.includes('sndcdn.com');
        }

        if (element.style.backgroundImage) {
            return element.style.backgroundImage.includes('sndcdn.com');
        }

        const imageSelectors = [
            '.image__full',
            '.image__lightOutline',
            '.sc-artwork',
            '.sound__coverArt',
            '.playbackSoundBadge__avatar',
            '.soundBadge__avatarArtwork',
            '.userBadge__avatar',
            '.profileHeaderInfo__avatar',
            '.artistAvatar',
            '.userAvatar'
        ];

        return imageSelectors.some(selector => element.closest(selector));
    }

    // Determine if image is avatar or artwork
    function getImageType(element) {
        const avatarSelectors = [
            '.userBadge__avatar',
            '.profileHeaderInfo__avatar',
            '.artistAvatar',
            '.userAvatar'
        ];

        if (avatarSelectors.some(selector => element.closest(selector))) {
            return 'avatar';
        }

        const imgUrl = getImageUrl(element);
        if (imgUrl && imgUrl.includes('avatars-')) {
            return 'avatar';
        }

        return 'artwork';
    }

    // Get image URL from element
    function getImageUrl(element) {
        targetElement = element;

        if (element.tagName === 'IMG') {
            return element.src;
        }

        if (element.style.backgroundImage) {
            const match = element.style.backgroundImage.match(/url\(["']?(.+?)["']?\)/);
            return match ? match[1] : null;
        }

        const img = element.querySelector('img');
        if (img) {
            targetElement = img;
            return img.src;
        }

        const parent = element.closest('.sc-artwork, .sound__coverArt, .playbackSoundBadge__avatar');
        if (parent) {
            const bgImage = window.getComputedStyle(parent).backgroundImage;
            const match = bgImage.match(/url\(["']?(.+?)["']?\)/);
            if (match) {
                targetElement = parent;
                return match[1];
            }
        }

        return null;
    }

    // Initialize
    contextMenu = createContextMenu();

    // Handle right-click
    document.addEventListener('contextmenu', function(e) {
        if (isSoundCloudImage(e.target)) {
            e.preventDefault();

            const imageUrl = getImageUrl(e.target);
            if (imageUrl) {
                targetImage = imageUrl;
                imageType = getImageType(e.target);

                contextMenu.innerHTML = '';

                const saveImageItem = createMenuItem('Save Image', saveArtwork);
                contextMenu.appendChild(saveImageItem);

                if (imageType === 'artwork') {
                    const downloadSongItem = createMenuItem('Save Track', downloadSong);
                    contextMenu.appendChild(downloadSongItem);
                }

                // Playlist page: offer batch download
                const currentPath = window.location.pathname;
                if (currentPath.includes('/sets/')) {
                    const playlistItem = createMenuItem('Save Playlist', downloadPlaylist);
                    contextMenu.appendChild(playlistItem);
                }

                // Likes page: offer batch download
                if (currentPath.endsWith('/likes')) {
                    const likesItem = createMenuItem('Save Likes', downloadLikes);
                    contextMenu.appendChild(likesItem);
                }

                contextMenu.style.left = e.clientX + 'px';
                contextMenu.style.top = e.clientY + 'px';
                contextMenu.style.display = 'block';
            }
        } else {
            hideContextMenu();
        }
    });

    // Hide menu on click elsewhere
    document.addEventListener('click', function(e) {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // Hide menu on scroll
    window.addEventListener('scroll', hideContextMenu);
})();

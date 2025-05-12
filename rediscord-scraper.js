// ==UserScript==
// @name         ReDiscord Scraper
// @namespace    https://github.com/artoof
// @version      3.5.1
// @description  Convenient Rediscord scraper of messages from channels with GUI
// @author       artoof
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(() => {
  let token = null;
  let scraping = false;
  let stopRequested = false;
  let allMessages = [];
  let lastBefore = null;
  let attempts = 0;
  let exportFormat = 'txt';
  let lastTokenInput = '';
  let tokenCheckTimeout = null;
  let tokenValid = false;

  let gui, logConsole, btnStart, btnStop, selectChannel, inputStartId, inputEndId, inputDelay, inputToken, selectExport;
  let progressText, downloadedCountText, channelLabel;

  function logToConsole(...args) {
    if (!logConsole) return;
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : a)).join(' ');
    const line = document.createElement('div');
    line.textContent = msg;
    line.style.whiteSpace = 'pre-wrap';
    logConsole.appendChild(line);
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  function errorLogToConsole(...args) {
    if (!logConsole) return;
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a, null, 2) : a)).join(' ');
    const line = document.createElement('div');
    line.textContent = msg;
    line.style.color = '#ed4245';
    line.style.whiteSpace = 'pre-wrap';
    line.style.cursor = 'pointer';
    line.title = 'Click to copy error';
    line.addEventListener('click', () => {
      navigator.clipboard.writeText(line.textContent || '').catch(() => {});
    });
    logConsole.appendChild(line);
    logConsole.scrollTop = logConsole.scrollHeight;
  }

  function snowflakeCompare(id1, id2) {
    if (id1 === id2) return 0;
    return BigInt(id1) < BigInt(id2) ? -1 : 1;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isMediaOnlyMessage(message) {
    if (message.content && message.content.trim().length > 0) return false;
    if (message.attachments && message.attachments.length > 0) return true;
    if (message.embeds && message.embeds.length > 0) return true;
    return false;
  }

  function getGuildIdFromURL() {
    try {
      const parts = location.pathname.split('/');
      if (parts.length >= 3 && parts[1] === 'channels') {
        return parts[2];
      }
    } catch {
      return null;
    }
    return null;
  }

  async function fetchGuildChannels(guildId) {
    if (!token) {
      token = inputToken.value.trim();
      if (!token) throw new Error('Token not specified');
    }
    const url = `https://discord.com/api/v9/guilds/${guildId}/channels`;
    const response = await fetch(url, {
      headers: { Authorization: token },
      method: 'GET',
      credentials: 'include',
    });
    if (response.status === 429) {
      const json = await response.json();
      const retryAfter = json.retry_after ? json.retry_after * 1000 : 5000;
      logToConsole(`Rate limit when fetching channels! Waiting ${retryAfter} ms...`);
      await sleep(retryAfter);
      return fetchGuildChannels(guildId);
    }
    if (response.status === 401) {
      errorLogToConsole('Token is invalid!');
      tokenValid = false;
      throw new Error('Token is invalid!');
    }
    if (response.status === 400) {
      errorLogToConsole('Error fetching channels 400: Not on a server page. Please navigate to a Discord server channel and re-enter your token.');
      tokenValid = false;
      throw new Error('Error fetching channels 400: Not on a server page.');
    }
    if (!response.ok) {
      const text = await response.text();
      errorLogToConsole(`Error fetching channels: ${response.status} ${response.statusText}`, text);
      throw new Error(`Error fetching channels: ${response.status} ${response.statusText}`);
    }
    tokenValid = true;
    const data = await response.json();
    return data.filter(c => c.type === 0);
  }

  async function fetchMessages(channelId, before, limit = 100) {
    if (!token) {
      token = inputToken.value.trim();
      if (!token) throw new Error('Token not specified');
    }
    const url = new URL(`https://discord.com/api/v9/channels/${channelId}/messages`);
    url.searchParams.append('limit', limit);
    if (before) url.searchParams.append('before', before);

    logToConsole(`Requesting messages: channel=${channelId}, limit=${limit}, before=${before || 'none'}`);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      method: 'GET',
      credentials: 'include',
    });

    logToConsole(`Server response: status=${response.status} ${response.statusText}`);

    if (response.status === 429) {
      const json = await response.json();
      const retryAfter = json.retry_after ? json.retry_after * 1000 : 5000;
      logToConsole(`Rate limit hit! Waiting ${retryAfter} ms before retry...`);
      await sleep(retryAfter);
      return fetchMessages(channelId, before, limit);
    }

    if (!response.ok) {
      const text = await response.text();
      errorLogToConsole(`Request error: ${response.status} ${response.statusText}`, text);
      throw new Error(`Request error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  function getInputTrimmed(input) {
    if (!input) return '';
    if (typeof input.value !== 'string') return '';
    return input.value.trim();
  }

  function clearLogs() {
    if (logConsole) logConsole.innerHTML = '';
  }

  function saveMessages(messages, guildId, channelId, olderId, newerId, format = 'txt') {
    let blob, filename;
    if (format === 'json') {
      const jsonArr = messages.map(m => ({
        datetime: m.timestamp,
        nickname: m.author.username,
        userid: m.author.id,
        message: m.content,
        messageid: m.id
      }));
      blob = new Blob([JSON.stringify(jsonArr, null, 2)], { type: 'application/json' });
      filename = `rediscord_scrape_${guildId}_${channelId}_${olderId}_${newerId}.json`;
    } else {
      const result = messages.map(m => {
        const date = new Date(m.timestamp).toLocaleString();
        const author = `${m.author.username}#${m.author.discriminator} (${m.author.id})`;
        const content = m.content || '[Empty message]';
        return `${date} | ${author}\n${content}\n[Message ID: ${m.id}]`;
      }).join('\n\n');
      blob = new Blob([result], { type: 'text/plain' });
      filename = `rediscord_scrape_${guildId}_${channelId}_${olderId}_${newerId}.txt`;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function startScraping() {
    if (scraping) return;
    scraping = true;
    stopRequested = false;
    allMessages = [];
    lastBefore = null;
    attempts = 0;
    clearLogs();

    setInputsDisabled(true);
    inputDelay.disabled = false;

    btnStart.disabled = true;
    btnStop.disabled = false;
    progressText.textContent = 'Initializing...';
    downloadedCountText.textContent = 'Downloaded messages: 0';

    const guildId = getGuildIdFromURL();
    if (!guildId) {
      alert('Could not determine server ID from URL. Open a Discord channel page in the format https://discord.com/channels/{guildId}/{channelId}');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
      setInputsDisabled(false);
      return;
    }

    const channelOption = selectChannel.selectedOptions[0];
    if (!channelOption) {
      alert('Please select a channel');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
      setInputsDisabled(false);
      return;
    }
    const channelId = channelOption.value;

    const startId = getInputTrimmed(inputStartId);
    const endId = getInputTrimmed(inputEndId);
    const delayStr = getInputTrimmed(inputDelay);
    const delayMs = Number(delayStr);
    const tokenValue = getInputTrimmed(inputToken);

    if (!startId || !endId) {
      alert('Both start and end message IDs are required');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
      setInputsDisabled(false);
      return;
    }
    if (isNaN(delayMs) || delayMs < 0) {
      alert('Delay must be a number greater or equal to 0');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
      setInputsDisabled(false);
      return;
    }
    if (!tokenValue) {
      alert('Token is required');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
      setInputsDisabled(false);
      return;
    }

    token = tokenValue;

    const cmp = snowflakeCompare(startId, endId);
    const olderId = cmp < 0 ? startId : endId;
    const newerId = cmp < 0 ? endId : startId;

    try {
      progressText.textContent = 'Downloading messages...';

      const batchLimit = 100;
      const maxAttempts = 2000;
      let downloadedCount = 0;

      while (!stopRequested && attempts < maxAttempts) {
        attempts++;
        logToConsole(`Request #${attempts}, before=${lastBefore || 'none'}`);

        const startTime = Date.now();
        const messages = await fetchMessages(channelId, lastBefore, batchLimit);
        const elapsed = Date.now() - startTime;

        if (messages.length === 0) {
          logToConsole('No more messages, finishing');
          break;
        }

        const filtered = messages.filter(m => {
          return snowflakeCompare(m.id, olderId) >= 0 &&
            snowflakeCompare(m.id, newerId) <= 0 &&
            !isMediaOnlyMessage(m);
        });

        allMessages.push(...filtered);
        downloadedCount += filtered.length;

        downloadedCountText.textContent = `Downloaded messages: ${downloadedCount}`;

        const minId = messages.reduce((min, m) => snowflakeCompare(m.id, min) < 0 ? m.id : min, messages[0].id);
        if (lastBefore === minId) {
          logToConsole('Minimum ID did not change, stopping loop');
          break;
        }
        lastBefore = minId;

        if (messages.some(m => m.id === olderId)) {
          logToConsole(`Found oldest ID ${olderId}, finishing download`);
          break;
        }

        const waitTime = Math.max(delayMs - elapsed, 0);
        if (waitTime > 0) {
          logToConsole(`Waiting ${waitTime} ms before next request...`);
          await sleep(waitTime);
        }
      }

      if (allMessages.length === 0) {
        alert('No messages found in the specified range. Check IDs and permissions.');
        logToConsole('No messages found');
        scraping = false;
        btnStart.disabled = false;
        btnStop.disabled = true;
        progressText.textContent = '';
        downloadedCountText.textContent = '';
        setInputsDisabled(false);
        return;
      }

      const uniqueMessagesMap = new Map();
      for (const m of allMessages) uniqueMessagesMap.set(m.id, m);
      const uniqueMessages = Array.from(uniqueMessagesMap.values());

      uniqueMessages.sort((a, b) => snowflakeCompare(a.id, b.id));

      const startIndex = uniqueMessages.findIndex(m => m.id === startId);
      const endIndex = uniqueMessages.findIndex(m => m.id === endId);

      if (startIndex === -1 || endIndex === -1) {
        alert('Could not find one of the specified messages in loaded data. Try expanding the range.');
        logToConsole(`startId found: ${startIndex !== -1}, endId found: ${endIndex !== -1}`);
        scraping = false;
        btnStart.disabled = false;
        btnStop.disabled = true;
        progressText.textContent = '';
        downloadedCountText.textContent = '';
        setInputsDisabled(false);
        return;
      }

      const sliceStart = Math.min(startIndex, endIndex);
      const sliceEnd = Math.max(startIndex, endIndex);

      const messagesToSave = uniqueMessages.slice(sliceStart, sliceEnd + 1);

      logToConsole(`Total messages to save: ${messagesToSave.length}`);

      saveMessages(messagesToSave, guildId, channelId, olderId, newerId, exportFormat);

      progressText.textContent = `Done. File saved. (${messagesToSave.length} messages)`;
    } catch (e) {
      alert('Error: ' + e.message);
      errorLogToConsole('Error during scraping:', e);
      progressText.textContent = 'Error: ' + e.message;
    } finally {
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      setInputsDisabled(false);
    }
  }

  function stopScraping() {
    if (!scraping) return;
    stopRequested = true;
    logToConsole('Scraping stop requested...');
    btnStop.disabled = true;
    progressText.textContent += ' (Stopping...)';

    setTimeout(() => {
      if (allMessages.length > 0) {
        const guildId = getGuildIdFromURL();
        const channelId = selectChannel.selectedOptions[0]?.value || 'unknown';
        const startId = getInputTrimmed(inputStartId);
        const endId = getInputTrimmed(inputEndId);
        const cmp = snowflakeCompare(startId, endId);
        const olderId = cmp < 0 ? startId : endId;
        const newerId = cmp < 0 ? endId : startId;
        saveMessages(allMessages, guildId, channelId, olderId, newerId, exportFormat);
        progressText.textContent = `Stopped. Partial file saved. (${allMessages.length} messages)`;
      } else {
        progressText.textContent = 'Stopped. No messages saved.';
      }
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      setInputsDisabled(false);
    }, 500);
  }

  function setInputsDisabled(disabled) {
    inputToken.disabled = disabled;
    selectChannel.disabled = disabled || selectChannel.options.length === 0 || selectChannel.options[0].text === 'Insert your token first' || selectChannel.options[0].text === 'Not on a server page' || selectChannel.options[0].text === 'Error loading channels' || selectChannel.options[0].text === 'No text channels found';
    inputStartId.disabled = disabled;
    inputEndId.disabled = disabled;
    selectExport.disabled = disabled;
    inputDelay.disabled = false;
  }

  function createGUI() {
    if (gui) return;

    gui = document.createElement('div');
    gui.style.position = 'fixed';
    gui.style.top = '60px';
    gui.style.right = '20px';
    gui.style.width = '420px';
    gui.style.height = '650px';
    gui.style.backgroundColor = '#2f3136';
    gui.style.border = '1px solid #202225';
    gui.style.borderRadius = '8px';
    gui.style.zIndex = 999999;
    gui.style.display = 'flex';
    gui.style.flexDirection = 'column';
    gui.style.fontFamily = 'Arial, sans-serif';
    gui.style.color = 'white';
    gui.style.boxShadow = '0 0 10px rgba(0,0,0,0.8)';
    gui.style.userSelect = 'none';
    gui.style.minWidth = '320px';
    gui.style.maxWidth = '90vw';
    gui.style.maxHeight = '90vh';
    gui.style.overflow = 'hidden';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.flexDirection = 'column';
    header.style.justifyContent = 'center';
    header.style.padding = '10px';
    header.style.backgroundColor = '#202225';
    header.style.borderTopLeftRadius = '8px';
    header.style.borderTopRightRadius = '8px';
    header.style.cursor = 'grab';
    header.style.userSelect = 'none';

    const title = document.createElement('div');
    title.textContent = 'ReDiscord Scraper';
    title.style.fontWeight = '700';
    title.style.fontSize = '18px';
    title.style.lineHeight = '1.2';
    title.style.userSelect = 'none';

    const subtitle = document.createElement('div');
    subtitle.style.fontSize = '11px';
    subtitle.style.color = '#72767d';
    subtitle.style.userSelect = 'none';
    subtitle.style.fontWeight = '400';
    subtitle.style.fontFamily = 'Arial, sans-serif';
    subtitle.style.marginTop = '-2px';
    subtitle.innerHTML = `by artoof v3.5.1 - <a href="https://github.com/artoof" target="_blank" rel="noopener noreferrer" style="color:#5865f2; text-decoration:none;">GitHub</a>`;

    header.appendChild(title);
    header.appendChild(subtitle);

    gui.appendChild(header);

    makeDraggable(gui, header);

    const form = document.createElement('div');
    form.style.padding = '10px';
    form.style.flex = '0 0 auto';
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '8px';
    form.style.maxHeight = '320px';
    form.style.overflowY = 'auto';
    form.style.background = 'linear-gradient(to bottom, #2f3136 90%, #23272a 100%)';

    const inputTokenObj = createLabeledInput('Discord Token:', 'password');
    inputToken = inputTokenObj.input;
    form.appendChild(inputTokenObj.container);

    channelLabel = document.createElement('label');
    channelLabel.style.fontSize = '13px';
    channelLabel.style.userSelect = 'none';
    channelLabel.style.marginTop = '0';
    form.appendChild(channelLabel);

    selectChannel = document.createElement('select');
    selectChannel.style.padding = '6px 8px';
    selectChannel.style.borderRadius = '4px';
    selectChannel.style.border = '1px solid #40444b';
    selectChannel.style.backgroundColor = '#202225';
    selectChannel.style.color = 'white';
    selectChannel.style.fontSize = '14px';
    selectChannel.style.width = '100%';
    selectChannel.style.boxSizing = 'border-box';
    selectChannel.style.fontStyle = 'normal';
    selectChannel.disabled = true;
    form.appendChild(selectChannel);

    const exportLabel = document.createElement('label');
    exportLabel.textContent = 'Export Format:';
    exportLabel.style.fontSize = '13px';
    exportLabel.style.userSelect = 'none';
    exportLabel.style.marginTop = '0';
    form.appendChild(exportLabel);

    selectExport = document.createElement('select');
    selectExport.style.padding = '6px 8px';
    selectExport.style.borderRadius = '4px';
    selectExport.style.border = '1px solid #40444b';
    selectExport.style.backgroundColor = '#202225';
    selectExport.style.color = 'white';
    selectExport.style.fontSize = '14px';
    selectExport.style.width = '100%';
    selectExport.style.boxSizing = 'border-box';
    selectExport.innerHTML = `
      <option value="txt">.txt</option>
      <option value="json">.json</option>
    `;
    selectExport.addEventListener('change', () => {
      exportFormat = selectExport.value;
    });
    form.appendChild(selectExport);

    inputToken.addEventListener('input', () => {
      if (tokenCheckTimeout) clearTimeout(tokenCheckTimeout);
      tokenCheckTimeout = setTimeout(() => {
        const val = inputToken.value.trim();
        if (val !== lastTokenInput) {
          lastTokenInput = val;
          if (val.length === 0) {
            selectChannel.innerHTML = '';
            selectChannel.disabled = true;
            selectChannel.style.fontStyle = 'italic';
            selectChannel.innerHTML = '<option>Insert your token first</option>';
            channelLabel.textContent = 'Select Channel:';
            btnStart.disabled = true;
            btnStop.disabled = true;
          } else {
            btnStart.disabled = false;
            loadChannels();
          }
        }
      }, 3000);
    });

    const inputStartIdObj = createLabeledInput('Start Message ID:');
    inputStartId = inputStartIdObj.input;
    form.appendChild(inputStartIdObj.container);

    const inputEndIdObj = createLabeledInput('End Message ID:');
    inputEndId = inputEndIdObj.input;
    form.appendChild(inputEndIdObj.container);

    const inputDelayObj = createLabeledInput('Delay Between Requests (ms):', 'number');
    inputDelay = inputDelayObj.input;
    inputDelay.value = '1200';
    form.appendChild(inputDelayObj.container);

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.justifyContent = 'space-between';
    btnContainer.style.marginTop = '10px';
    btnContainer.style.gap = '10px';

    btnStart = document.createElement('button');
    btnStart.textContent = 'Start Scraping';
    btnStart.style.flex = '1';
    btnStart.style.backgroundColor = '#5865f2';
    btnStart.style.color = 'white';
    btnStart.style.border = 'none';
    btnStart.style.borderRadius = '4px';
    btnStart.style.cursor = 'pointer';
    btnStart.style.fontWeight = '600';
    btnStart.style.fontSize = '16px';
    btnStart.style.padding = '10px 0';
    btnStart.style.minWidth = '0';
    btnStart.disabled = true;
    btnStart.onclick = () => {
      btnStart.disabled = true;
      btnStop.disabled = false;
      startScraping();
    };

    btnStop = document.createElement('button');
    btnStop.textContent = 'Stop Scraping';
    btnStop.style.flex = '1';
    btnStop.style.backgroundColor = '#ed4245';
    btnStop.style.color = 'white';
    btnStop.style.border = 'none';
    btnStop.style.borderRadius = '4px';
    btnStop.style.cursor = 'pointer';
    btnStop.style.fontWeight = '600';
    btnStop.style.fontSize = '16px';
    btnStop.style.padding = '10px 0';
    btnStop.style.minWidth = '0';
    btnStop.disabled = true;
    btnStop.onclick = stopScraping;

    btnContainer.appendChild(btnStart);
    btnContainer.appendChild(btnStop);
    form.appendChild(btnContainer);

    progressText = document.createElement('div');
    progressText.style.fontSize = '14px';
    progressText.style.fontWeight = 'bold';
    progressText.style.margin = '8px 0 2px 0';
    progressText.style.whiteSpace = 'nowrap';
    progressText.style.overflow = 'hidden';
    progressText.style.textOverflow = 'ellipsis';
    form.appendChild(progressText);

    downloadedCountText = document.createElement('div');
    downloadedCountText.style.fontSize = '13px';
    downloadedCountText.style.marginBottom = '2px';
    downloadedCountText.style.whiteSpace = 'nowrap';
    downloadedCountText.style.overflow = 'hidden';
    downloadedCountText.style.textOverflow = 'ellipsis';
    form.appendChild(downloadedCountText);

    gui.appendChild(form);

    logConsole = document.createElement('div');
    logConsole.style.flex = '1 1 0';
    logConsole.style.background = '#23272a';
    logConsole.style.borderRadius = '6px';
    logConsole.style.padding = '8px';
    logConsole.style.margin = '10px';
    logConsole.style.overflowY = 'auto';
    logConsole.style.fontSize = '12px';
    logConsole.style.fontFamily = 'monospace';
    logConsole.style.height = '100%';
    logConsole.style.border = '1px solid #202225';
    logConsole.style.boxSizing = 'border-box';

    gui.appendChild(logConsole);

    const style = document.createElement('style');
    style.innerHTML = `
      div[style*="overflow-y: auto"] {
        scrollbar-width: thin;
        scrollbar-color: #5865f2 #23272a;
      }
      div[style*="overflow-y: auto"]::-webkit-scrollbar {
        width: 10px;
        background: transparent;
        border-radius: 6px;
      }
      div[style*="overflow-y: auto"]::-webkit-scrollbar-thumb {
        background: #5865f2;
        border-radius: 6px;
        border: 2px solid #23272a;
      }
      div[style*="overflow-y: auto"]::-webkit-scrollbar-thumb:hover {
        background: #4752c4;
      }
      .channels-3g2vYe::-webkit-scrollbar-thumb {
        background-color: #2f3136 !important;
        border-radius: 4px !important;
        border: 2px solid #202225 !important;
      }
      .channels-3g2vYe::-webkit-scrollbar {
        background-color: transparent !important;
        width: 8px !important;
      }
      .channels-3g2vYe {
        scrollbar-width: thin !important;
        scrollbar-color: #2f3136 transparent !important;
      }
      .rediscord-input-label {
        margin-bottom: 2px !important;
      }
    `;
    document.head.appendChild(style);

    selectChannel.innerHTML = '<option>Insert your token first</option>';
    selectChannel.style.fontStyle = 'italic';
    selectChannel.disabled = true;
    channelLabel.textContent = 'Select Channel:';

    document.body.appendChild(gui);
  }

  function createLabeledInput(label, type = 'text') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.minWidth = '0';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.className = 'rediscord-input-label';
    lbl.style.fontSize = '13px';
    lbl.style.userSelect = 'none';
    lbl.style.flexShrink = '0';
    lbl.style.whiteSpace = 'nowrap';
    lbl.style.marginBottom = '2px';
    const input = document.createElement('input');
    input.type = type;
    input.style.padding = '6px 8px';
    input.style.borderRadius = '4px';
    input.style.border = '1px solid #40444b';
    input.style.backgroundColor = '#202225';
    input.style.color = 'white';
    input.style.fontSize = '14px';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.minWidth = '0';
    container.appendChild(lbl);
    container.appendChild(input);
    return { container, input };
  }

  function makeDraggable(element, handle) {
    let offsetX = 0, offsetY = 0, isDown = false;
    handle.addEventListener('mousedown', function(e) {
      isDown = true;
      offsetX = element.offsetLeft - e.clientX;
      offsetY = element.offsetTop - e.clientY;
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mouseup', function() {
      isDown = false;
      document.body.style.userSelect = '';
    });
    document.addEventListener('mousemove', function(e) {
      if (!isDown) return;
      let newLeft = e.clientX + offsetX;
      let newTop = e.clientY + offsetY;

      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const elW = element.offsetWidth;
      const elH = element.offsetHeight;

      if (newLeft < 0) newLeft = 0;
      if (newTop < 0) newTop = 0;
      if (newLeft + elW > winW) newLeft = winW - elW;
      if (newTop + elH > winH) newTop = winH - elH;

      element.style.left = newLeft + 'px';
      element.style.top = newTop + 'px';
      element.style.right = '';
      element.style.bottom = '';
    });
  }

  async function loadChannels() {
    if (!getGuildIdFromURL()) {
      errorLogToConsole('Error fetching channels 400: Not on a server page. Please navigate to a Discord server channel and re-enter your token.');
      selectChannel.innerHTML = '<option>Not on a server page</option>';
      selectChannel.disabled = true;
      selectChannel.style.fontStyle = 'normal';
      channelLabel.textContent = 'Select Channel:';
      btnStart.disabled = true;
      btnStop.disabled = true;
      return;
    }
    selectChannel.innerHTML = '';
    const guildId = getGuildIdFromURL();
    if (!guildId) return;
    token = inputToken.value.trim();
    if (!token) return;
    try {
      const channels = await fetchGuildChannels(guildId);
      if (channels.length === 0) {
        selectChannel.innerHTML = '<option>No text channels found</option>';
        selectChannel.disabled = true;
        selectChannel.style.fontStyle = 'normal';
        channelLabel.textContent = 'Select Channel:';
        btnStart.disabled = true;
        btnStop.disabled = true;
        return;
      }
      channels.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        selectChannel.appendChild(opt);
      });
      selectChannel.disabled = false;
      selectChannel.style.fontStyle = 'normal';
      channelLabel.textContent = 'Select Channel:';
      btnStart.disabled = false;
      logToConsole('Channels loaded');
    } catch (e) {
      errorLogToConsole('Failed to load channels:', e.message);
      selectChannel.innerHTML = '<option>Error loading channels</option>';
      selectChannel.disabled = true;
      selectChannel.style.fontStyle = 'normal';
      channelLabel.textContent = 'Select Channel:';
      btnStart.disabled = true;
      btnStop.disabled = true;
    }
  }

  createGUI();
})();

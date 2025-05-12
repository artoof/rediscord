// ==UserScript==
// @name         ReDiscord Scraper
// @namespace    https://github.com/artoof
// @version      3.2.5
// @description  Convenient Rediscord scraper of messages from channels with GUI
// @author       artoof
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(() => {
  let token = null; // Is this global token always the right one? Feels like something could go wrong, but... maybe not?
  let scraping = false;
  let stopRequested = false;
  let allMessages = [];
  let lastBefore = null;
  let attempts = 0;

  let gui, logConsole, btnStart, btnStop, selectChannel, inputStartId, inputEndId, inputDelay, inputToken;
  let progressText, downloadedCountText;

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
    const line = document.createElement('div'); // Hardcoded API version again. Do not mind me
    line.textContent = msg;
    line.style.color = 'red';
    line.style.whiteSpace = 'pre-wrap';
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
    if (!response.ok) {
      const text = await response.text();
      errorLogToConsole(`Error fetching channels: ${response.status} ${response.statusText}`, text);
      throw new Error(`Error fetching channels: ${response.status} ${response.statusText}`);
    }
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

  async function startScraping() {
    if (scraping) return;
    scraping = true;
    stopRequested = false;
    allMessages = [];
    lastBefore = null;
    attempts = 0;

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
      return;
    }
    if (isNaN(delayMs) || delayMs < 0) {
      alert('Delay must be a number greater or equal to 0');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
      return;
    }
    if (!tokenValue) {
      alert('Token is required');
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      progressText.textContent = '';
      downloadedCountText.textContent = '';
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

        // Filter out media-only messages
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

        if (messages.some(m => m.id === olderId)) { // We need to trust this most shittiest check i've ever wrote in my life!
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
        return;
      }

      const sliceStart = Math.min(startIndex, endIndex);
      const sliceEnd = Math.max(startIndex, endIndex);

      const messagesToSave = uniqueMessages.slice(sliceStart, sliceEnd + 1);

      logToConsole(`Total messages to save: ${messagesToSave.length}`);

      const result = messagesToSave.map(m => {
        const date = new Date(m.timestamp).toLocaleString();
        const author = `${m.author.username}#${m.author.discriminator} (${m.author.id})`;
        const content = m.content || '[Empty message]';
        return `${date} | ${author}\n${content}\n[Message ID: ${m.id}]`;
      }).join('\n\n');

      const blob = new Blob([result], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `rediscord_scrape_${guildId}_${channelId}_${olderId}_${newerId}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      alert(`Saved messages: ${messagesToSave.length}`);
      logToConsole('Script finished successfully');
      progressText.textContent = 'Done. File saved.';
    } catch (e) {
      alert('Error: ' + e.message);
      errorLogToConsole('Error during scraping:', e);
      progressText.textContent = 'Error: ' + e.message;
    } finally {
      scraping = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
    }
  }

  function stopScraping() {
    if (!scraping) return;
    stopRequested = true;
    logToConsole('Scraping stop requested...');
    btnStop.disabled = true;
    progressText.textContent += ' (Stopping...)';
  }

  function createGUI() {
    if (gui) return; // If GUI exists it's okay, if it is not then we crash

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

    const header = document.createElement('div');
    header.textContent = 'ReDiscord Scraper';
    header.style.fontWeight = '700';
    header.style.fontSize = '18px';
    header.style.padding = '10px';
    header.style.backgroundColor = '#202225';
    header.style.borderTopLeftRadius = '8px';
    header.style.borderTopRightRadius = '8px';
    header.style.cursor = 'grab';
    header.style.userSelect = 'none';
    gui.appendChild(header);

    makeDraggable(gui, header);

    const form = document.createElement('div');
    form.style.padding = '10px';
    form.style.flex = '0 0 auto';
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '8px';

    const inputTokenObj = createLabeledInput('Discord Token:', 'password');
    inputToken = inputTokenObj.input;
    form.appendChild(inputTokenObj.container);

    const channelLabel = document.createElement('label');
    channelLabel.textContent = 'Select Channel:';
    channelLabel.style.fontSize = '13px';
    channelLabel.style.userSelect = 'none';
    form.appendChild(channelLabel);

    selectChannel = document.createElement('select');
    selectChannel.style.padding = '6px 8px';
    selectChannel.style.borderRadius = '4px';
    selectChannel.style.border = '1px solid #40444b';
    selectChannel.style.backgroundColor = '#202225';
    selectChannel.style.color = 'white';
    selectChannel.style.fontSize = '14px';
    selectChannel.style.width = '100%';
    form.appendChild(selectChannel);

    inputToken.addEventListener('change', loadChannels); // I hope you don't paste some extra in the token field cuz this thing will fuck you up and I just don't want to fix it
    setTimeout(() => {
      if (inputToken.value.trim()) loadChannels();
    }, 300);

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

    btnStart = document.createElement('button');
    btnStart.textContent = 'Start Scraping';
    btnStart.style.flex = '1';
    btnStart.style.marginRight = '10px';
    btnStart.style.backgroundColor = '#5865f2';
    btnStart.style.color = 'white';
    btnStart.style.border = 'none';
    btnStart.style.borderRadius = '4px';
    btnStart.style.cursor = 'pointer';
    btnStart.style.fontWeight = '600';
    btnStart.style.fontSize = '16px';
    btnStart.style.padding = '10px 0';
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
    btnStop.disabled = true;
    btnStop.onclick = stopScraping;

    btnContainer.appendChild(btnStart);
    btnContainer.appendChild(btnStop);

    form.appendChild(btnContainer);

    gui.appendChild(form);

    progressText = document.createElement('div');
    progressText.style.color = '#b9bbbe';
    progressText.style.fontSize = '14px';
    progressText.style.padding = '6px 10px';
    progressText.style.userSelect = 'none';
    gui.appendChild(progressText);

    logConsole = document.createElement('div');
    logConsole.style.flex = '1 1 auto';
    logConsole.style.backgroundColor = '#1e1f22';
    logConsole.style.margin = '10px';
    logConsole.style.padding = '8px';
    logConsole.style.borderRadius = '6px';
    logConsole.style.overflowY = 'auto';
    logConsole.style.fontSize = '12px';
    logConsole.style.fontFamily = 'monospace';
    logConsole.style.whiteSpace = 'pre-wrap';
    gui.appendChild(logConsole);

    downloadedCountText = document.createElement('div');
    downloadedCountText.style.color = '#b9bbbe';
    downloadedCountText.style.fontSize = '14px';
    downloadedCountText.style.padding = '6px 10px';
    downloadedCountText.style.userSelect = 'none';
    downloadedCountText.textContent = 'Downloaded messages: 0';
    gui.appendChild(downloadedCountText);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.title = 'Close Window';
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '5px';
    closeBtn.style.right = '10px';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = 'white';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.userSelect = 'none';
    closeBtn.onclick = () => {
      gui.style.display = 'none';
    };
    gui.appendChild(closeBtn);

    document.body.appendChild(gui);
  }

  async function loadChannels() {
    const guildId = getGuildIdFromURL();
    if (!guildId) {
      logToConsole('Could not determine server ID from URL, channels not loaded');
      return;
    }
    if (!token) {
      token = getInputTrimmed(inputToken);
      if (!token) {
        logToConsole('Enter Discord token to load channels');
        return;
      }
    }
    try {
      logToConsole('Loading server channels...');
      selectChannel.disabled = true;
      selectChannel.innerHTML = '';
      const channels = await fetchGuildChannels(guildId);
      if (!channels.length) {
        logToConsole('No text channels found or no access');
        return;
      }
      for (const ch of channels) {
        const option = document.createElement('option');
        option.value = ch.id;
        option.textContent = `#${ch.name}`;
        selectChannel.appendChild(option);
      }
      selectChannel.disabled = false;
      logToConsole(`Loaded channels: ${channels.length}`);
    } catch (e) {
      errorLogToConsole('Error loading channels:', e);
      selectChannel.disabled = true;
    }
  }

  function createLabeledInput(labelText, type = 'text') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.marginBottom = '3px';
    label.style.fontSize = '13px';
    label.style.userSelect = 'none';

    const input = document.createElement('input');
    input.type = type;
    input.style.padding = '6px 8px';
    input.style.borderRadius = '4px';
    input.style.border = '1px solid #40444b';
    input.style.backgroundColor = '#202225';
    input.style.color = 'white';
    input.style.fontSize = '14px';

    container.appendChild(label);
    container.appendChild(input);

    return { container, input };
  }

  function makeDraggable(element, handle) {
    let posX = 0, posY = 0, mouseX = 0, mouseY = 0;

    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      mouseX = e.clientX;
      mouseY = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
      handle.style.cursor = 'grabbing';
    }

    function elementDrag(e) {
      e.preventDefault();
      posX = mouseX - e.clientX;
      posY = mouseY - e.clientY;
      mouseX = e.clientX;
      mouseY = e.clientY;
      const rect = element.getBoundingClientRect();
      let newTop = rect.top - posY;
      let newLeft = rect.left - posX;

      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      if (newLeft < 0) newLeft = 0;
      if (newTop < 0) newTop = 0;
      if (newLeft > maxLeft) newLeft = maxLeft;
      if (newTop > maxTop) newTop = maxTop;

      element.style.top = newTop + "px";
      element.style.left = newLeft + "px";
      element.style.right = 'auto';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
      handle.style.cursor = 'grab';
    }
  }

  function addMainButton() {
    const toolbar = document.querySelector('[class^="toolbar"]');
    if (!toolbar || document.getElementById('rediscordScrapeBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'rediscordScrapeBtn';
    btn.textContent = 'ReDiscord Scraper';
    btn.style.cssText = `
      margin-left: 10px;
      padding: 5px 12px;
      background-color: #5865f2;
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
    btn.onclick = () => {
      if (!gui) createGUI();
      gui.style.display = 'flex';
    };
    toolbar.appendChild(btn);
  }

  setInterval(addMainButton, 1000);
  createGUI();
})();


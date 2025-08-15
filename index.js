const { globalShortcut } = require('electron');

module.exports = function PingerFinalCorrected(mod) {
    const language = mod.settings.language || 'en';
    let STRINGS;
    try {
        STRINGS = require(`./locales/${language}.json`);
    } catch (e) {
        console.error(`[Pinger] Failed to load language file for '${language}'. Falling back to 'en'.`);
        STRINGS = require('./locales/en.json');
    }

    function format(str, ...args) {
        if (!str) return '';
        let i = 0;
        return str.replace(/%[sd]/g, (match) => {
            const arg = args[i++];
            if (match === '%d') return parseInt(arg, 10);
            return arg;
        });
    }

    function t(key, ...args) {
        const template = STRINGS[key];
        if (!template) {
            console.error(`[Pinger] Missing translation for key: ${key}`);
            return key;
        }
        return format(template, ...args);
    }

    const internalConfig = { channelIndex: 6, channelId: -3, minInterval: 1000, maxInterval: 3000, intervalStep: 200 };
    let state = { privateloaded: false, pingInProgress: false, lastSent: 0, timeout: null, interval: internalConfig.minInterval, lastPing: 0, hooks: [], dynamicBaseline: mod.settings.dynamicBaseline, baselineHistory: [], highLatencyState: false, badPingCounter: 0 };
    function saveLearnedState() { mod.settings.dynamicBaseline = state.dynamicBaseline; mod.saveSettings(); }

    const COMMAND_DEFINITIONS = {
        "toggle": "command_desc_toggle",
        "hotkey [key]": "command_desc_hotkey",
        "color": "command_desc_color",
        "set [param] [value]": "command_desc_set",
        "reset": "command_desc_reset",
        "info": "command_desc_info"
    };

    const commands = {
        toggle: () => {
            mod.settings.enabled = !mod.settings.enabled;
            mod.saveSettings();
            if (mod.settings.enabled) startPinging();
            else stopPinging();
            mod.command.message(mod.settings.enabled ? t('enabled') : t('disabled'));
        },
        hotkey: (...args) => {
            const hotkey = args.join(" ");
            if (!hotkey) {
                mod.command.message(mod.settings.hotkey ? t('hotkey_current', mod.settings.hotkey) : t('hotkey_none'));
                return;
            }
            const formattedHotkey = hotkey.toLowerCase().split("+").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("+");
            if (mod.settings.hotkey) globalShortcut.unregister(mod.settings.hotkey);
            try {
                globalShortcut.register(formattedHotkey, () => mod.command.exec('pinger toggle'));
                mod.settings.hotkey = formattedHotkey;
                mod.saveSettings();
                mod.command.message(t('hotkey_set', mod.settings.hotkey));
            } catch (e) {
                mod.command.message(t('hotkey_fail', hotkey, e.message));
                if (mod.settings.hotkey) {
                    try { globalShortcut.register(mod.settings.hotkey, () => mod.command.exec('pinger toggle')); } 
                    catch (reRegisterError) { mod.command.message(t('hotkey_fail', mod.settings.hotkey, reRegisterError.message)); }
                }
            }
        },
        color: () => {
            mod.settings.coloredOutput = !mod.settings.coloredOutput;
            mod.saveSettings();
            mod.command.message(mod.settings.coloredOutput ? t('color_enabled') : t('color_disabled'));
        },
        set: (param, value) => {
            if (!param) { commands.info(); return; }
            const paramLower = param.toLowerCase();
            if (paramLower === 'language' || paramLower === 'lang') {
                const supportedLanguages = ['en', 'zh'];
                const supportedLangsStr = supportedLanguages.join(', ');
                if (!value) { mod.command.message(t('lang_current', mod.settings.language, supportedLangsStr)); return; }
                const valueLower = value.toLowerCase();
                if (supportedLanguages.includes(valueLower)) {
                    mod.settings.language = valueLower;
                    mod.saveSettings();
                    mod.command.message(t('lang_set', valueLower));
                } else {
                    mod.command.message(t('lang_unsupported', value, supportedLangsStr));
                }
                return;
            }
            const numValue = parseInt(value, 10);
            if (isNaN(numValue)) { mod.command.message(t('param_invalid', value, param)); return; }
            let settingKey, min, max;
            switch (paramLower) {
                case 'jitter': settingKey = 'minAbsoluteJitter'; min = 5; max = 100; break;
                case 'minlatency': settingKey = 'minAbsoluteHighLatency'; min = 50; max = 300; break;
                case 'history': settingKey = 'baselineHistorySize'; min = 10; max = 100; break;
                default: mod.command.message(t('param_unknown', param)); return;
            }
            if (numValue >= min && numValue <= max) {
                mod.settings[settingKey] = numValue;
                mod.saveSettings();
                mod.command.message(t('param_updated', paramLower, numValue));
            } else {
                mod.command.message(t('param_out_of_range', value, paramLower, min, max));
            }
        },
        reset: () => {
            const resetValue = state.lastPing || mod.settings.dynamicBaseline || 80;
            state.dynamicBaseline = resetValue;
            state.baselineHistory = Array(mod.settings.baselineHistorySize).fill(resetValue);
            state.highLatencyState = false;
            state.badPingCounter = 0;
            saveLearnedState();
            mod.command.message(t('reset_success'));
        },
        info: () => {
            let msg = t('info_header') + "\n";
            for (const [command, descriptionKey] of Object.entries(COMMAND_DEFINITIONS)) {
                 msg += t('info_command_line', command, t(descriptionKey)) + "\n";
            }
            msg += t('info_config_header') + "\n";
            msg += t('info_config_jitter', mod.settings.minAbsoluteJitter) + "\n";
            msg += t('info_config_minlatency', mod.settings.minAbsoluteHighLatency) + "\n";
            msg += t('info_config_history', mod.settings.baselineHistorySize) + "\n";
            msg += t('info_config_language', mod.settings.language) + "\n";
            msg += t('info_current_avg', Math.round(state.dynamicBaseline)) + "\n";
            const hotkeyStr = mod.settings.hotkey ? `<font color="#00FF00">${mod.settings.hotkey}</font>` : `<font color="#FF4500">${t('hotkey_none').split(': ')[1] || ''}</font>`;
            msg += t('info_current_hotkey', hotkeyStr);
            mod.command.message(msg);
        }
    };

    mod.command.add('pinger', (cmd, ...args) => {
        const handler = commands[cmd];
        if (handler) handler(...args);
        else commands.info();
    });
    
    function updateBaseline(pingValue, isHighJitter) { if (isHighJitter) return; state.baselineHistory.push(pingValue); if (state.baselineHistory.length > mod.settings.baselineHistorySize) { state.baselineHistory.shift(); } const sortedHistory = [...state.baselineHistory].sort((a, b) => a - b); const mid = Math.floor(sortedHistory.length / 2); state.dynamicBaseline = (sortedHistory.length % 2 === 0) ? Math.round((sortedHistory[mid - 1] + sortedHistory[mid]) / 2) : sortedHistory[mid]; }
    function processPing(currentPing) { const jitter = Math.abs(currentPing - state.lastPing); const isHighJitter = jitter > mod.settings.minAbsoluteJitter; updateBaseline(currentPing, isHighJitter); const highLatencyThreshold = Math.max(state.dynamicBaseline + mod.settings.minAbsoluteJitter, mod.settings.minAbsoluteHighLatency); const isHighLatency = currentPing > highLatencyThreshold; if (isHighLatency) { if (++state.badPingCounter >= 2) state.highLatencyState = true; } else { state.badPingCounter = 0; state.highLatencyState = false; } state.interval = isHighJitter ? Math.max(internalConfig.minInterval, state.interval - internalConfig.intervalStep) : Math.min(internalConfig.maxInterval, state.interval + internalConfig.intervalStep); printPing(currentPing, jitter, isHighJitter, isHighLatency); state.lastPing = currentPing; }
    function sendPingRequest() { if (state.pingInProgress || !mod.settings.enabled) return; state.pingInProgress = true; mod.send('C_REQUEST_GAMESTAT_PING', 1, null); state.lastSent = Date.now(); state.timeout = mod.setTimeout(() => { state.pingInProgress = false; sendPingRequest(); }, 5000); }
    function printPing(pingValue, jitter, isHighJitter, isHighLatency) { let color = 'FFFFFF'; if (mod.settings.coloredOutput) { const jitterThreshold = mod.settings.minAbsoluteJitter; const highLatencyThreshold = Math.max(state.dynamicBaseline + jitterThreshold, mod.settings.minAbsoluteHighLatency); const yellowThreshold = state.dynamicBaseline + Math.max(jitterThreshold * 0.4, 5); if (pingValue < yellowThreshold) color = '00FF00'; else if (pingValue < highLatencyThreshold) color = 'FFFF00'; else color = 'FF0000'; } let message = ` ${pingValue}ms`; const wasInHighLatency = state.highLatencyState; if (isHighLatency) { message += wasInHighLatency ? t('high_latency_label') : t('jitter_label', Math.round(jitter)); } else { if (wasInHighLatency) message += t('network_recovered_label'); else if (isHighJitter) message += t('jitter_label', Math.round(jitter)); } mod.send('S_PRIVATE_CHAT', 1, { channel: internalConfig.channelId, authorID: 0, authorName: '', message: `<font color="#${color}">${message}</font>` }); }
    function hook() { state.hooks.push(mod.hook(...arguments)); }
    function unhookAll() { state.hooks.forEach(h => mod.unhook(h)); state.hooks = []; }
    function startPinging() { stopPinging(); if (!state.privateloaded) return; state.dynamicBaseline = mod.settings.dynamicBaseline; state.baselineHistory = Array(mod.settings.baselineHistorySize).fill(state.dynamicBaseline); state.highLatencyState = false; state.badPingCounter = 0; state.lastPing = state.dynamicBaseline; hook('S_RESPONSE_GAMESTAT_PONG', 'raw', () => { mod.clearTimeout(state.timeout); const currentPing = Date.now() - state.lastSent; processPing(currentPing); state.pingInProgress = false; state.timeout = mod.setTimeout(sendPingRequest, Math.max(0, state.interval - currentPing)); return false; }); hook('C_REQUEST_GAMESTAT_PING', 'raw', () => false); sendPingRequest(); }
    function stopPinging() { mod.clearTimeout(state.timeout); state.timeout = null; state.pingInProgress = false; unhookAll(); saveLearnedState(); }
    function initialize() { if (mod.settings.hotkey) commands.hotkey(mod.settings.hotkey); mod.hook('S_LOGIN', 14, () => { state.privateloaded = false; stopPinging(); }); mod.hook('S_SPAWN_ME', 3, () => { if (state.privateloaded) return; state.privateloaded = true; mod.send('S_JOIN_PRIVATE_CHANNEL', 2, { index: internalConfig.channelIndex, channelId: internalConfig.channelId, unk: [], name: "Ping" }); if (mod.settings.enabled) startPinging(); }); const channelHooks = [['S_JOIN_PRIVATE_CHANNEL', 2, e => e.index === internalConfig.channelIndex ? false : undefined], ['C_LEAVE_PRIVATE_CHANNEL', 1, e => e.index === internalConfig.channelIndex ? false : undefined], ['C_CHAT', 1, { order: -100 }, e => e.channel === 11 + internalConfig.channelIndex ? false : undefined], ['C_REQUEST_PRIVATE_CHANNEL_INFO', 2, e => { if (e.channelId === internalConfig.channelId) { mod.send('S_REQUEST_PRIVATE_CHANNEL_INFO', 2, { owner: true, password: 0, members: [], friends: [] }); return false; } }]]; channelHooks.forEach(h => mod.hook(...h)); mod.game.on('leave_game', stopPinging); mod.destructor = saveLearnedState; }
    
    initialize();
};
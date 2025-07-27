const { globalShortcut } = require('electron');

module.exports = function PingerFinalCorrected(mod) {
    // --- 开发者内部常量 ---
    const internalConfig = {
        channelIndex: 6,
        channelId: -3,
        minInterval: 1000,
        maxInterval: 3000,
        intervalStep: 200,
    };

    // --- 状态管理 ---
    let state = {
        privateloaded: false,
        pingInProgress: false,
        lastSent: 0,
        timeout: null,
        interval: internalConfig.minInterval,
        lastPing: 0,
        hooks: [],
        dynamicBaseline: mod.settings.dynamicBaseline,
        baselineHistory: [],
        highLatencyState: false,
        badPingCounter: 0
    };

    // --- 保存函数 ---
    function saveLearnedState() {
        mod.settings.dynamicBaseline = state.dynamicBaseline;
        mod.saveSettings();
    }

    // --- 用户消息本地化/集中管理 ---
    const MESSAGES = {
        get enabled() { return `Ping显示功能已<font color="#00FF00">启用</font>`; },
        get disabled() { return `Ping显示功能已<font color="#FF4500">禁用</font>`; },
        get color_enabled() { return `彩色输出已<font color="#00FF00">启用</font>`; },
        get color_disabled() { return `彩色输出已<font color="#FF4500">禁用</font>`; },
        hotkey_set: (key) => `新快捷键已设置: <font color="#00FF00">${key}</font>`,
        hotkey_current: (key) => `当前快捷键: <font color="#00FF00">${key || "未设置"}</font>`,
        hotkey_fail: (key, err) => `注册快捷键 <font color="#FF4500">${key}</font> 失败: ${err}`,
        hotkey_invalid: (key) => `无效的快捷键: <font color="#FF4500">${key}</font>`,
        param_updated: (name, value) => `参数 <font color="#00FF00">${name}</font> 已更新为 <font color="#00FF00">${value}</font>。`,
        param_invalid: (name, value) => `无效的值 <font color="#FF4500">${value}</font> 用于参数 <font color="#FF4500">${name}</font>。`,
        param_unknown: (name) => `未知的参数 <font color="#FF4500">${name}</font>。`,
        unknown_command: () => "未知的子命令。使用 '<font color=\"#00FF00\">pinger info</font>' 查看可用命令和配置。",
        info: () => {
            let msg = "Ping显示模块已加载。可用命令：\n";
            for (const [command, description] of Object.entries(COMMAND_DEFINITIONS)) {
                msg += `-<font color="#00FF00"> pinger ${command}</font>: ${description}\n`;
            }
            msg += `\n当前配置: (使用 "pinger set [参数] [值]" 修改)\n`;
            msg += `- <font color="#FFFF00">抖动阈值 (jitter)</font>: ${mod.settings.minAbsoluteJitter}ms\n`;
            msg += `- <font color="#FFFF00">最低高延迟 (minlatency)</font>: ${mod.settings.minAbsoluteHighLatency}ms\n`;
            msg += `- <font color="#FFFF00">历史记录数 (history)</font>: ${mod.settings.baselineHistorySize}\n`;
            msg += `\n当前平均延迟: <font color="#00BFFF">~${state.dynamicBaseline}ms</font>\n`;
            msg += `\n当前快捷键: ${mod.settings.hotkey ? `<font color="#00FF00">${mod.settings.hotkey}</font>` : `<font color="#FF4500">未设置</font>`}`;
            return msg;
        },
        reset_success: () => "平均延迟记录已重置，将从当前延迟开始重新计算。",
    };

    // --- [已删除] 错误的 }; ---

    // --- 命令定义与处理 ---
    const COMMAND_DEFINITIONS = {
        "toggle": "启用或禁用Ping显示功能",
        "hotkey [快捷键]": "设置或查看模块的切换快捷键",
        "color": "切换Ping值的彩色/单色输出",
        "set [参数] [值]": "修改插件的自适应参数 (jitter, minlatency, history)",
        "reset": "手动重置插件计算到的平均延迟记录",
        "info": "显示所有可用命令、配置和当前状态"
    };

    const commands = {
        toggle: () => {
            mod.settings.enabled = !mod.settings.enabled;
            mod.saveSettings();
            if (mod.settings.enabled) {
                state.pingInProgress = false;
                startPinging();
            } else {
                stopPinging();
            }
            mod.command.message(mod.settings.enabled ? MESSAGES.enabled : MESSAGES.disabled);
        },
        hotkey: (...args) => {
            const hotkey = args.join(" ");
            if (!hotkey) {
                mod.command.message(MESSAGES.hotkey_current(mod.settings.hotkey));
                return;
            }
            const formattedHotkey = hotkey.toLowerCase().split("+").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("+");
            if (mod.settings.hotkey) {
                globalShortcut.unregister(mod.settings.hotkey);
            }
            try {
                globalShortcut.register(formattedHotkey, () => mod.command.exec('pinger toggle'));
                mod.settings.hotkey = formattedHotkey;
                mod.saveSettings();
                mod.command.message(MESSAGES.hotkey_set(mod.settings.hotkey));
            } catch (e) {
                mod.command.message(MESSAGES.hotkey_fail(hotkey, e.message));
                if (mod.settings.hotkey) {
                    try {
                        globalShortcut.register(mod.settings.hotkey, () => mod.command.exec('pinger toggle'));
                    } catch (reRegisterError) {
                        mod.command.message(MESSAGES.hotkey_fail(mod.settings.hotkey, reRegisterError.message));
                    }
                }
            }
        },
        color: () => {
            mod.settings.coloredOutput = !mod.settings.coloredOutput;
            mod.saveSettings();
            mod.command.message(mod.settings.coloredOutput ? MESSAGES.color_enabled : MESSAGES.color_disabled);
        },
        set: (param, value) => {
            const numValue = parseInt(value, 10);
            if (isNaN(numValue)) {
                mod.command.message(MESSAGES.param_invalid(param, value));
                return;
            }

            let settingKey, min, max;
            switch (param.toLowerCase()) {
                case 'jitter':
                    settingKey = 'minAbsoluteJitter';
                    min = 5; max = 100;
                    break;
                case 'minlatency':
                    settingKey = 'minAbsoluteHighLatency';
                    min = 50; max = 300;
                    break;
                case 'history':
                    settingKey = 'baselineHistorySize';
                    min = 10; max = 100;
                    break;
                default:
                    mod.command.message(MESSAGES.param_unknown(param));
                    return;
            }

            if (numValue >= min && numValue <= max) {
                mod.settings[settingKey] = numValue;
                mod.saveSettings();
                mod.command.message(MESSAGES.param_updated(param, numValue));
            } else {
                mod.command.message(MESSAGES.param_invalid(param, `${value} (必须在 ${min}-${max} 之间)`));
            }
        },
        reset: () => {
            // 在 reset 函数中，由于删除了 defaultSettings，我们需要一个备用值
            const resetValue = state.lastPing || mod.settings.dynamicBaseline || 80;
            state.dynamicBaseline = resetValue;
            state.baselineHistory = Array(mod.settings.baselineHistorySize).fill(resetValue);
            state.highLatencyState = false;
            state.badPingCounter = 0;
            saveLearnedState();
            mod.command.message(MESSAGES.reset_success());
        },
        info: () => {
            mod.command.message(MESSAGES.info());
        }
    };

    mod.command.add('pinger', (cmd, ...args) => {
        if (!cmd) {
            mod.command.message(MESSAGES.info());
            return;
        }
        if (commands[cmd]) {
            commands[cmd](...args);
        } else {
            mod.command.message(MESSAGES.unknown_command());
        }
    });

    // --- Ping 逻辑 ---
    function updateBaseline(pingValue, isHighJitter) {
        if (!isHighJitter) {
            state.baselineHistory.push(pingValue);
            if (state.baselineHistory.length > mod.settings.baselineHistorySize) {
                state.baselineHistory.shift();
            }

            const sortedHistory = [...state.baselineHistory].sort((a, b) => a - b);
            const mid = Math.floor(sortedHistory.length / 2);
            state.dynamicBaseline = (sortedHistory.length % 2 === 0) 
                ? Math.round((sortedHistory[mid - 1] + sortedHistory[mid]) / 2) 
                : sortedHistory[mid];
        }
    }

    function processPing(currentPing) {
        const jitter = Math.abs(currentPing - state.lastPing);
        const isHighJitter = jitter > mod.settings.minAbsoluteJitter;

        updateBaseline(currentPing, isHighJitter);

        const highLatencyThreshold = Math.max(state.dynamicBaseline + mod.settings.minAbsoluteJitter, mod.settings.minAbsoluteHighLatency);
        const isHighLatency = currentPing > highLatencyThreshold;

        if (isHighLatency) {
            state.badPingCounter++;
            if (state.badPingCounter >= 2) {
                state.highLatencyState = true;
            }
        } else {
            state.badPingCounter = 0;
            state.highLatencyState = false; // 明确在高延迟消除时重置状态
        }

        if (isHighJitter) {
            state.interval = Math.max(internalConfig.minInterval, state.interval - internalConfig.intervalStep);
        } else {
            state.interval = Math.min(internalConfig.maxInterval, state.interval + internalConfig.intervalStep);
        }

        printPing(currentPing, jitter, isHighJitter, isHighLatency);
        state.lastPing = currentPing;
    }

    function sendPingRequest() {
        if (state.pingInProgress) return;
        state.pingInProgress = true;
        mod.send('C_REQUEST_GAMESTAT_PING', 1, null);
        state.lastSent = Date.now();
        state.timeout = mod.setTimeout(() => {
            state.pingInProgress = false;
            if(mod.settings.enabled) sendPingRequest();
        }, 5000);
    }

    function printPing(pingValue, jitter, isHighJitter, isHighLatency) {
        let color = 'FFFFFF';
        if (mod.settings.coloredOutput) {
            const jitterThreshold = mod.settings.minAbsoluteJitter;
            const highLatencyThreshold = Math.max(state.dynamicBaseline + jitterThreshold, mod.settings.minAbsoluteHighLatency);
            const yellowThreshold = state.dynamicBaseline + Math.max(jitterThreshold * 0.4, 5);
    
            if (pingValue < yellowThreshold) color = '00FF00';
            else if (pingValue < highLatencyThreshold) color = 'FFFF00';
            else color = 'FF0000';
        }

        let message = ` ${pingValue}ms`;
        let extraInfo = '';
        
        const wasInHighLatency = state.highLatencyState;

        if (isHighLatency) {
            if (wasInHighLatency) {
                extraInfo = ` <font color="#FF4500">(延迟过高)</font>`;
            } else if (isHighJitter) {
                 extraInfo = ` <font color="#FF4500">(抖动: ${Math.round(jitter)}ms)</font>`;
            }
        } else {
            if (wasInHighLatency) {
                extraInfo = ` <font color="#00FF00">(网络恢复)</font>`;
            } else if (isHighJitter) {
                extraInfo = ` <font color="#FF4500">(抖动: ${Math.round(jitter)}ms)</font>`;
            }
        }
        
        message += extraInfo;
        
        mod.send('S_PRIVATE_CHAT', 1, {
            channel: internalConfig.channelId,
            authorID: 0,
            authorName: '',
            message: `<font color="#${color}">${message}</font>`
        });
    }

    function hook() {
        state.hooks.push(mod.hook(...arguments));
    }

    function unhookAll() {
        state.hooks.forEach(h => mod.unhook(h));
        state.hooks = [];
    }

    function startPinging() {
        stopPinging();
        if (!state.privateloaded) return;

        state.dynamicBaseline = mod.settings.dynamicBaseline;
        state.baselineHistory = Array(mod.settings.baselineHistorySize).fill(state.dynamicBaseline);
        
        state.highLatencyState = false;
        state.badPingCounter = 0;
        state.lastPing = state.dynamicBaseline;

        hook('S_RESPONSE_GAMESTAT_PONG', 'raw', () => {
            const currentPing = Date.now() - state.lastSent;
            
            processPing(currentPing);
            
            mod.clearTimeout(state.timeout);
            state.timeout = mod.setTimeout(() => {
                state.pingInProgress = false;
                if (mod.settings.enabled) sendPingRequest();
            }, Math.max(0, state.interval - currentPing));
            
            return false;
        });
        
        hook('C_REQUEST_GAMESTAT_PING', 'raw', () => false);

        sendPingRequest();
    }
    
    function stopPinging() {
        mod.clearTimeout(state.timeout);
        state.timeout = null;
        unhookAll();
        saveLearnedState();
    }

    // --- 游戏事件处理 ---
    function initialize() {
        if (mod.settings.hotkey) {
            commands.hotkey(mod.settings.hotkey);
        }

        mod.hook('S_LOGIN', 14, () => {
            state.privateloaded = false;
            stopPinging();
        });

        mod.hook('S_SPAWN_ME', 3, () => {
            if (state.privateloaded) return;
            state.privateloaded = true;
            mod.send('S_JOIN_PRIVATE_CHANNEL', 2, {
                index: internalConfig.channelIndex,
                channelId: internalConfig.channelId,
                unk: [],
                name: "Ping"
            });
            if (mod.settings.enabled) {
                startPinging();
            }
            mod.command.message(MESSAGES.info());
        });
        
        mod.hook('S_JOIN_PRIVATE_CHANNEL', 2, event => {
            if (event.index === internalConfig.channelIndex) return false;
        });
    
        mod.hook('C_LEAVE_PRIVATE_CHANNEL', 1, event => {
            if (event.index === internalConfig.channelIndex) return false;
        });
    
        mod.hook('C_CHAT', 1, { order: -100 }, event => {
            if (event.channel === 11 + internalConfig.channelIndex) return false;
        });
    
        mod.hook('C_REQUEST_PRIVATE_CHANNEL_INFO', 2, event => {
            if (event.channelId === internalConfig.channelId) {
                mod.send('S_REQUEST_PRIVATE_CHANNEL_INFO', 2, {
                    owner: true,
                    password: 0,
                    members: [],
                    friends: []
                });
                return false;
            }
        });

        mod.game.on('leave_game', () => {
            stopPinging();
        });
        
        mod.destructor = () => {
            saveLearnedState();
        };
    }

    initialize();
};
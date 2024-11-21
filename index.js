const { globalShortcut } = require('electron');

module.exports = function pinger(mod) {
    const channelIndex = 6;
    const channelId = -3;
    let privateloaded = false;
    let interval = 1000;
    let timeout = null;
    let lastSent = 0;
    let hooks = [];
    let pingInProgress = false;
    const commandsInfo = {
        "pinger toggle": "Enable or disable the pinger module.",
        "pinger hotkey [hotkey]": "Set a hotkey to enable or disable the module.",
        "pinger color": "Toggle colored output for ping values.",
        "pinger info": "Show information about available commands and the current hotkey."
    };

    function registerHotkey(hotkey) {
        try {
            if (globalShortcut.isRegistered(hotkey)) {
                globalShortcut.unregister(hotkey);
            }
            globalShortcut.register(hotkey, () => {
                mod.command.exec('pinger toggle');  // Выполнение команды pinger.
            });
            mod.command.message(`Hotkey ${hotkey} registered for pinger command.`);
        } catch (e) {
            mod.command.message(`Failed to register hotkey ${hotkey}: ${e.message}`);
        }
    }

    mod.hook('S_LOGIN', 'raw', () => { 
        privateloaded = false;
    });
    
    mod.hook('S_SPAWN_ME', 'raw', () => {
        if (privateloaded) return;
        privateloaded = true;
        mod.send('S_JOIN_PRIVATE_CHANNEL', 2, {
            index: channelIndex,
            channelId: channelId,
            unk: [],
            name: "Ping"
        });
        if (mod.settings.enabled) pingcheck();
    });

    mod.hook('S_JOIN_PRIVATE_CHANNEL', 2, event => {
        if (event.index === channelIndex) return false;
    });

    mod.hook('C_LEAVE_PRIVATE_CHANNEL', 1, event => {
        if (event.index === channelIndex) return false;
    });

    mod.hook('C_REQUEST_PRIVATE_CHANNEL_INFO', 2, event => {
        if (event.channelId === channelId) {
            mod.send('S_REQUEST_PRIVATE_CHANNEL_INFO', 2, {
                owner: true,
                password: 0,
                members: [],
                friends: []
            });
            return false;
        }
    });

    mod.hook('C_CHAT', 1, { order: -100 }, event => {
        if (event.channel === 11 + channelIndex) return false;
    });

    mod.command.add('pinger', (cmd, ...args) => {
        switch (cmd) {
            case 'toggle':
                const enabled = mod.settings.enabled = !mod.settings.enabled;
                mod.saveSettings();
                if (enabled) {
                    pingInProgress = false;  // Сброс состояния
                    pingcheck();
                } else {
                    mod.clearTimeout(timeout);
                    unhookAll();
                }
                mod.command.message(`Pinger ${enabled ? `<font color="#00FF00">enabled</font>` : `<font color="#FF4500">disabled</font>`}`);
                break;

            case 'hotkey':
                const hotkey = args.join(" ");
                if (!hotkey) {
                    mod.command.message(`Current hotkey: ${mod.settings.hotkey}`);
                } else {
                    if (hotkey.toLowerCase() !== mod.settings.hotkey.toLowerCase()) {
                        const formattedHotkey = hotkey.toLowerCase().split("+").map(w => w[0].toUpperCase() + w.substr(1)).join("+");
                        try {
                            registerHotkey(formattedHotkey);
                            mod.settings.hotkey = formattedHotkey;
                            mod.saveSettings();
                            mod.command.message(`New hotkey: ${mod.settings.hotkey}`);
                        } catch (e) {
                            mod.command.message(`Invalid hotkey: ${hotkey}`);
                        }
                    }
                }
                break;

            case 'color':
                mod.settings.coloredOutput = !mod.settings.coloredOutput;
                mod.saveSettings();
                mod.command.message(`Colored output ${mod.settings.coloredOutput ? `<font color="#00FF00">enabled</font>` : `<font color="#FF4500">disabled</font>`}.`);
                break;

            case 'info':
                let infoMessage = "Available commands:\n";
                for (const [command, description] of Object.entries(commandsInfo)) {
                    infoMessage += `- ${command}: ${description}\n`;
                }
                infoMessage += `\nCurrent hotkey: ${mod.settings.hotkey || 'not installed'}`;
                mod.command.message(infoMessage);
                break;

            default:
                mod.command.message("Unknown subcommand. Use 'pinger info' to see available commands.");
                break;
        }
    });

    function ping() {
        if (pingInProgress) return;  // Предотвращаем перекрытие вызовов ping()
        pingInProgress = true;
        mod.send('C_REQUEST_GAMESTAT_PING', 1);
        lastSent = Date.now();
        timeout = mod.setTimeout(() => {
            pingInProgress = false;
            ping();
        }, 24000);        
    }

    function pingcheck() {
        if (mod.settings.enabled) {            
            ping();
            hook('S_SPAWN_ME', 'raw', () => {
                mod.clearTimeout(timeout);
                timeout = mod.setTimeout(() => {
                    pingInProgress = false;
                    ping();
                }, interval);
            });
            hook('C_REQUEST_GAMESTAT_PING', 'raw', () => { return false });
            hook('S_RESPONSE_GAMESTAT_PONG', 'raw', { order: -9999 }, (event) => {
                const result = Date.now() - lastSent;
                printPing(result);
                mod.clearTimeout(timeout);
                timeout = mod.setTimeout(() => {
                    pingInProgress = false;
                    ping();
                }, Math.max(0, interval - result));
                return false;
            });
        }
    }

    function printPing(pingValue) {
        let color = 'FFFFFF';
        if (mod.settings.coloredOutput) {
            if (pingValue < 70) color = '00FF00';
            else if (pingValue >= 70 && pingValue < 100) color = 'CCFF33';
            else if (pingValue >= 100 && pingValue < 200) color = 'FFFF00';
            else color = 'FF0000';
        }

        mod.send('S_PRIVATE_CHAT', 1, {
            channel: channelId,
            authorID: 0,
            authorName: '',
            message: mod.settings.coloredOutput 
                ? `<font color="#${color}"> ${pingValue} ms</font>` 
                : ` ${pingValue} ms`
        });
    }

    function hook() {
        hooks.push(mod.hook(...arguments));
    }

    function unhookAll() {
        hooks.forEach(hook => mod.unhook(hook));
        hooks = [];
    }

    mod.game.on('leave_game', () => {
        mod.clearTimeout(timeout);
        unhookAll();
    });

    if (mod.settings.enabled) pingcheck();
    registerHotkey(mod.settings.hotkey);
};

const fs = require('fs');
const path = require('path');
const globalShortcut = global.TeraProxy.GUIMode ? require('electron').globalShortcut : null;
const configPath = path.resolve(__dirname, 'config.json');
const MigrateSettings = require('./settings_migrator');
let moduleConfig = {};
    if (fs.existsSync(configPath)) {
        moduleConfig = JSON.parse(fs.readFileSync(configPath));
        if (!moduleConfig.data) {
            moduleConfig.data = {};
        }
    } else {
        moduleConfig = {            
            data: MigrateSettings(undefined, 1, {})
        };
        fs.writeFileSync(configPath, JSON.stringify(moduleConfig, null, 2));
    }

module.exports = function pinger(mod) {
    const channelIndex = 6;
    const channelId = -3;
    const keybinds = new Set();
    let privateloaded = false;
    let enabled = moduleConfig.data.enabled !== undefined ? moduleConfig.data.enabled : true;
    let interval = 1000;
    let timeout = null;
    let lastSent = 0;
    let hooks = [];
    let isPingCheckRunning = false;
    
    const commandsInfo = {
        "pinger toggle": "Enable or disable the pinger module.",
        "pinger hotkey [hotkey]": "Set a hotkey for enable or disable the module.",
        "pinger info": "Show information about available commands and the current hotkey."
    };
    
    if (moduleConfig.data.hotkey) {
        mod.settings.hotkey = moduleConfig.data.hotkey;
        globalShortcut.register(mod.settings.hotkey, () => mod.command.exec('pinger toggle'));
        keybinds.add(mod.settings.hotkey);
    }
    
    mod.command.add('pinger', (cmd, ...args) => {
        switch (cmd) {
            case 'toggle':
                moduleConfig.data.enabled = !moduleConfig.data.enabled;
                enabled = moduleConfig.data.enabled;
                mod.command.message(`Pinger ${enabled ? `<font color="#00FF00">enabled</font>` : `<font color="#FF4500">disabled</font>`}`);
                fs.writeFileSync(configPath, JSON.stringify(moduleConfig, null, 2));
                if (enabled) pingcheck();
                else {
                mod.clearTimeout(timeout);
                unhookAll();
                }
                break;

            case 'hotkey':
                const hotkey = args.join(" ");
                if (!hotkey) {
                    mod.command.message(`Current hotkey: ${mod.settings.hotkey || 'not installed'}`);
                } else {
                    try {
                        const formattedHotkey = hotkey.split("+").map(w => w[0].toUpperCase() + w.substr(1)).join("+");
                        if (mod.settings.hotkey) globalShortcut.unregister(mod.settings.hotkey);
                        globalShortcut.register(formattedHotkey, () => mod.command.exec('pinger toggle'));
                        keybinds.add(formattedHotkey);
                        mod.settings.hotkey = formattedHotkey;                        
                        moduleConfig.data.hotkey = formattedHotkey;
                        fs.writeFileSync(configPath, JSON.stringify(moduleConfig, null, 2));
                        mod.command.message(`Hotkey "${mod.settings.hotkey}" registered`);
                    } catch (e) {
                        mod.command.message(`Invalid hotkey: ${hotkey}`);
                    }
                }
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
        mod.send('C_REQUEST_GAMESTAT_PING', 1);
        lastSent = Date.now();
        timeout = mod.setTimeout(ping, 24000);
    }

    function pingcheck() {
        if (isPingCheckRunning) return;
        isPingCheckRunning = true;
        ping();
        hook('S_SPAWN_ME', 'raw', () => {
            mod.clearTimeout(timeout);
            timeout = mod.setTimeout(ping, interval);
        });
        hook('C_REQUEST_GAMESTAT_PING', 'raw', () => false);
        hook('S_RESPONSE_GAMESTAT_PONG', 'raw', { order: -9999 }, (event) => {
            const result = Date.now() - lastSent;
            printPing(result);
            mod.clearTimeout(timeout);
            timeout = mod.setTimeout(ping, interval - result);
            return false;
        });
    }

    function printPing(pingValue) {
        let color = 'FFFFFF';
        if (pingValue < 70) color = '00FF00';
        else if (pingValue >= 70 && pingValue < 100) color = 'CCFF33';
        else if (pingValue >= 100 && pingValue < 200) color = 'FFFF00';
        else color = 'FF0000';

        mod.send('S_PRIVATE_CHAT', 1, {
            channel: channelId,
            authorID: 0,
            authorName: '',
            message: `<font color="#${color}"> ${pingValue} ms</font>`
        });
    }

    function hook() {
        hooks.push(mod.hook(...arguments));
    }   

    mod.hook('S_LOGIN', 'raw', () => {
        privateloaded = false;
        enabled = moduleConfig.data.enabled;
        if (enabled) pingcheck();
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
        if (enabled) pingcheck();
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

    mod.game.on('leave_game', () => {
        moduleConfig.data.enabled = enabled;
        fs.writeFileSync(configPath, JSON.stringify(moduleConfig, null, 2));
    });

    function unhookAll() {
        hooks.forEach(hook => mod.unhook(hook));
        hooks = [];
        isPingCheckRunning = false;
    }

    this.destructor = () => {
        keybinds.forEach(keybind => globalShortcut.unregister(keybind));        
        moduleConfig.data.enabled = enabled;
        fs.writeFileSync(configPath, JSON.stringify(moduleConfig, null, 2));
    };
};

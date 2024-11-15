module.exports = function pinger(mod) {
    const fs = require('fs');
    const path = require('path');
    const { globalShortcut } = require('electron');
    const migrator = require('./settings_migrator');  
    const cmd = mod.command || mod.require.command;    
    const configPath = path.join(__dirname, 'config.json'); 
    const channelIndex = 6;
    const channelId = -3;
    let settings = loadSettings();  
    let privateloaded = false;
    let enabled = settings.data.enabled;  // Используем значение из конфига
    let interval = 1000;
    let timeout = null;
    let lastSent = 0;
    let hooks = [];
    let registeredHotkey = null;

    const localesPath = path.resolve(__dirname, 'locales.json');
    const toolboxConfigPath = path.resolve(__dirname, '..', '..', 'config.json'); 

    let locales = JSON.parse(fs.readFileSync(localesPath));

    let toolboxConfig = {};
    if (fs.existsSync(toolboxConfigPath)) {
        toolboxConfig = JSON.parse(fs.readFileSync(toolboxConfigPath));
    }

    let language = (toolboxConfig.uilanguage) ? toolboxConfig.uilanguage.toLowerCase() : 'en';
    let langStrings = locales[language] || locales['en']; 
    
    if (!langStrings.pingEnabled || !langStrings.pingDisabled) {
        console.error('Missing translation strings for language:', language);
        langStrings = locales['en']; 
    }
    
    function loadSettings() {
        let settings = null;

        try {
            if (fs.existsSync(configPath)) {
                settings = require(configPath);
                
                if (!settings.data) {
                    settings.data = {};  
                    //console.log("Initialized settings.data");
                }
            } else {
                settings = migrator(null, 2, {});
                settings.data = { hotkey: settings.hotkey, enabled: settings.enabled }; 
                saveSettings(settings);  
                //console.log("Created new settings file:", settings);
            }
        } catch (e) {
            console.error(`${langStrings.errorLoadSet} `, e);
            settings = migrator(null, 2, {});
            settings.data = { hotkey: settings.hotkey, enabled: settings.enabled }; 
            saveSettings(settings);  
        }

        return settings;
    }
    
    function saveSettings(settings) {
        fs.writeFileSync(configPath, JSON.stringify({ 
            version: 1, 
            data: settings.data 
        }, null, 4));
    }
    
    function registerHotkey() {
        try {
            if (settings?.data?.hotkey && settings.data.hotkey !== registeredHotkey) {
                if (registeredHotkey) {
                    globalShortcut.unregister(registeredHotkey);
                }
                globalShortcut.register(settings.data.hotkey, () => {
                    mod.command.exec("pinger");
                });
                registeredHotkey = settings.data.hotkey;

                mod.command.message(`${langStrings.loadHK} "${settings.data.hotkey}"`);
            }
        } catch (e) {
            mod.command.message(`${langStrings.errorHK} ${e.message}`);
        }
    }
    
    mod.hook('S_LOGIN', 'raw', () => {
        if (settings?.data?.hotkey) {
            registerHotkey();  
        }
    });
    
    cmd.add(['photkey'], (key) => {
        if (!key) {
            const hotkey = settings?.data?.hotkey || langStrings.notInst;
            mod.command.message(`${langStrings.currHK} ${hotkey}`);
        } else {
            settings.data.hotkey = key;
            saveSettings(settings);  
            registerHotkey();
            mod.command.message(`${langStrings.newHK} ${settings.data.hotkey}`);
        }
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
        if (event.index === 6) return false;
    });

    mod.hook('C_LEAVE_PRIVATE_CHANNEL', 1, event => {
        if (event.index === 6) return false;
    });

    mod.hook('C_REQUEST_PRIVATE_CHANNEL_INFO', 2, event => {
        if (event.channelId === -3) {
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
        if (event.channel === 11 + 6) return false;
    });
    
    cmd.add(['pinger'], () => {
        enabled = !enabled;
        
        if (enabled) {
            mod.command.message(`<font color="#56B4E9">${langStrings.pingEnabled}</font>`);
            pingcheck();  
        } else {
            mod.command.message(`<font color="#E69F00">${langStrings.pingDisabled}</font>`);
            mod.clearTimeout(timeout);  
            unhookAll();  
        }

        settings.data.enabled = enabled;
        saveSettings(settings);  
    });
    
    function ping() {
        mod.send('C_REQUEST_GAMESTAT_PING', 1);
        lastSent = Date.now();
        timeout = mod.setTimeout(ping, 24000);
    };
    
    function pingcheck() {
        ping();  
        hook('S_SPAWN_ME', 'raw', () => {
            mod.clearTimeout(timeout);  
            timeout = mod.setTimeout(ping, interval);  
        });
        hook('C_REQUEST_GAMESTAT_PING', 'raw', () => { return false });        
        hook('S_RESPONSE_GAMESTAT_PONG', 'raw', { order: -9999 }, (event) => {
            if (isNGSPModified(event)) {
                mod.command.message('NGSP packet detected, skipping...');
                return;  
            }
            const result = Date.now() - lastSent;  
            printPing(result);  
            mod.clearTimeout(timeout);  
            timeout = mod.setTimeout(ping, interval - result);  
            return false;
        });
    };
        
    function isNGSPModified(event) {        
        return false;
    };
    
    function printPing(pingValue) {
        let color = 'FFFFFF';
        if (pingValue < 70) color = '00FF00';
        else if (pingValue >= 70 && pingValue < 100) color = 'CCFF33';
        else if (pingValue >= 100 && pingValue < 200) color = 'FFFF00';
        else color = 'FF4500';

        let unit = (language === 'ru') ? 'мс' : 'ms'; 
        mod.send('S_PRIVATE_CHAT', 1, {
            channel: channelId,  
            authorID: 0,
            authorName: '',
            message: `<font color="#${color}"> ${pingValue} ${unit}</font>`  
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
        globalShortcut.unregisterAll();
        registeredHotkey = null;        
        if (settings?.data?.hotkey) {
            saveSettings(settings);  
        }
    });
};

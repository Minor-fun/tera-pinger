const fs = require('fs');
const path = require('path');
const localesPath = path.resolve(__dirname, 'locales.json');
const toolboxConfigPath = path.resolve(__dirname, '..', '..', 'config.json'); // путь к файлу config.json в корневой папке Toolbox

// Загрузка переводов
let locales = JSON.parse(fs.readFileSync(localesPath));

// Загрузка конфигурации Toolbox
let toolboxConfig = {};
if (fs.existsSync(toolboxConfigPath)) {
    toolboxConfig = JSON.parse(fs.readFileSync(toolboxConfigPath));
}

module.exports = function pinger(mod) {
    const channelIndex = 6;
    const channelId = -3;
    let privateloaded = false;
    let enabled = true; // Начальное значение, можно изменить при необходимости
    let interval = 1000;
    let timeout = null;
    let lastSent = 0;
    let hooks = [];

    // Определяем язык из конфигурации Toolbox
    let language = (toolboxConfig.uilanguage) ? toolboxConfig.uilanguage.toLowerCase() : 'en';
    let langStrings = locales[language] || locales['en']; // Если язык не найден, используем английский по умолчанию

    // Проверка на наличие необходимых строк перевода
    if (!langStrings.pingEnabled || !langStrings.pingDisabled) {
        console.error('Missing translation strings for language:', language);
        langStrings = locales['en']; // Используем английский по умолчанию
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
        
    mod.command.add(['pinger'], () => {
        enabled = !enabled;
        mod.command.message('Pinger ' + (enabled ? <font color="#56B4E9">${langStrings.pingEnabled}</font> : <font color="#E69F00">${langStrings.pingDisabled}</font>));
        console.log('Pinger ' + (enabled ? langStrings.pingEnabled : langStrings.pingDisabled));
        if (enabled) pingcheck();  
        else {
            mod.clearTimeout(timeout);  
            unhookAll();  
        }
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
        let color = 'FFFFFF';  // Белый цвет по умолчанию.
        if (pingValue < 70) color = '00FF00';  // Зеленый для пинга ниже 70 мс.
        else if (pingValue >= 70 && pingValue < 100) color = 'CCFF33';  // Светло-зеленый для пинга от 70 до 100 мс.
        else if (pingValue >= 100 && pingValue < 200) color = 'FFFF00';  // Желтый для пинга от 100 до 200 мс.
        else color = 'FF4500';  // Красный для пинга выше 200 мс.
        
        let unit = (language === 'ru') ? 'мс' : 'ms'; // Определяем единицу измерения в зависимости от языка
        mod.send('S_PRIVATE_CHAT', 1, {
            channel: channelId,  
            authorID: 0,
            authorName: '',
            message: <font color="#${color}"> ${pingValue} ${unit}</font>  
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
};
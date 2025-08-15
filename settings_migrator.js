'use strict';

const DefaultSettings = {
    language: 'en',
    enabled: true,
    coloredOutput: true,
    hotkey: "Ctrl+P",
    baselineHistorySize: 30,
    minAbsoluteJitter: 20,
    minAbsoluteHighLatency: 200,
    dynamicBaseline: 80,
};

module.exports = function MigrateSettings(from_ver, to_ver, settings) {
    if (from_ver === undefined) {
        return Object.assign({}, DefaultSettings, settings);
    } else if (from_ver === null) {
        return DefaultSettings;
    } else {
        if (from_ver + 1 < to_ver) {
            settings = MigrateSettings(from_ver, from_ver + 1, settings);
            return MigrateSettings(from_ver + 1, to_ver, settings);
        }
        
        settings = Object.assign({}, DefaultSettings, settings);

        return settings;
    }
};
module.exports = function pinger(mod) {
	const channelIndex = 6;
	const channelId = -3;
	let privateloaded = false;
	let enabled = true;  // Автоматическое включение пингера при входе
	let interval = 1000;
	let timeout = null;
	let lastSent = 0;
	let hooks = [];

	// Хук на событие логина. Устанавливает флаги при входе в игру.
	mod.hook('S_LOGIN', 'raw', () => { 
		privateloaded = false;
		enabled = true; // Автоматическое включение пингера при входе
	});
	
	// Хук на спавн игрока. Подключение к приватному каналу после спавна.
	mod.hook('S_SPAWN_ME', 'raw', () => {
		if (privateloaded) return;
		privateloaded = true;
		// Присоединение к приватному каналу.
		mod.send('S_JOIN_PRIVATE_CHANNEL', 2, {
			index: channelIndex,
			channelId: channelId,
			unk: [],
			name: "Ping"
		});
		// Если модуль активен, запускаем проверку пинга.
		if (enabled) pingcheck();
	});
	
	// Хук, предотвращающий обработку присоединения к приватному каналу.
	mod.hook('S_JOIN_PRIVATE_CHANNEL', 2, event => {
		if (event.index === channelIndex) return false;
	});
	
	// Хук, предотвращающий выход из приватного канала.
	mod.hook('C_LEAVE_PRIVATE_CHANNEL', 1, event => {
		if (event.index === channelIndex) return false;
	});
	
	// Хук на запрос информации о приватном канале. Предоставляет информацию о канале.
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
	
	// Хук, блокирующий чат, если используется канал пинга.
	mod.hook('C_CHAT', 1, { order: -100 }, event => {
		if (event.channel === 11 + channelIndex) return false;
	});
	
	// Команда для включения/выключения модуля пинга.
	mod.command.add(['pinger'], () => {
		enabled = !enabled;
		mod.command.message('Pinger ' + (enabled ? '<font color="#56B4E9">enabled</font>' : '<font color="#E69F00">disabled</font>'))
		console.log('Pinger ' + (enabled ? 'enabled' : 'disabled'))
		if (enabled) pingcheck();  // Запуск пингера при включении.
		else {
			mod.clearTimeout(timeout);  // Остановка таймера при отключении.
			unhookAll();  // Удаление всех хуков.
		}
	});
	
	// Функция для отправки запроса на получение пинга и установки следующего таймера.
	function ping() {
		mod.send('C_REQUEST_GAMESTAT_PING', 1);  // Отправка запроса на получение пинга.
		lastSent = Date.now();  // Запоминаем время отправки.
		timeout = mod.setTimeout(ping, 24000);  // Устанавливаем таймер для следующего запроса через 24 секунды.
	}
	
	// Функция, управляющая проверкой пинга и обрабатывающая ответ от сервера.
	function pingcheck() {
		ping();  // Отправляем запрос на пинг.
		hook('S_SPAWN_ME', 'raw', () => {
			mod.clearTimeout(timeout);  // Очищаем таймер, если игрок снова появился в игре.
			timeout = mod.setTimeout(ping, interval);  // Запускаем новый таймер.
		});
		// Блокируем запрос на пинг от клиента.
		hook('C_REQUEST_GAMESTAT_PING', 'raw', () => { return false });
		// Обработка ответа от сервера на пинг с более высоким приоритетом, чтобы перехватить оригинальный пакет до его изменения NGSP.
		hook('S_RESPONSE_GAMESTAT_PONG', 'raw', { order: -9999 }, (event) => {
			if (isNGSPModified(event)) {
				mod.command.message('NGSP packet detected, skipping...');
				return;  // Игнорируем пакеты, модифицированные NGSP.
			}
			const result = Date.now() - lastSent;  // Вычисляем пинг как разницу времени.
			printPing(result);  // Выводим пинг в чат.
			mod.clearTimeout(timeout);  // Очищаем старый таймер.
			timeout = mod.setTimeout(ping, interval - result);  // Устанавливаем новый таймер с поправкой на время пинга.
			return false;
		});
	}
	
	// Функция для проверки, был ли пакет изменен NGSP.
	function isNGSPModified(event) {
		// Здесь можно добавить проверку на изменения пакета, сделанные NGSP.
		// Например, проверка на наличие определенных значений или свойств, которые NGSP мог бы изменить.
		// Вернем false, если пакет не был модифицирован, иначе true.
		return false;
	}
	
	// Функция для вывода значения пинга в приватный чат с изменением цвета в зависимости от значения.
	function printPing(pingValue) {
		let color = 'FFFFFF';  // Белый цвет по умолчанию.
		// Меняем цвет в зависимости от значения пинга.
		if (pingValue < 70) color = '00FF00';  // Зеленый для пинга ниже 70 мс.
		else if (pingValue >= 70 && pingValue < 100) color = 'CCFF33';  // Светло-зеленый/желтоватый для пинга от 70 до 100 мс.
		else if (pingValue >= 100 && pingValue < 200) color = 'FFFF00';  // Желтый для пинга от 100 до 200 мс.
		else color = 'FF0000';  // Красный для пинга выше 200 мс.

		// Отправляем сообщение с пингом и его цветом в приватный чат.
		mod.send('S_PRIVATE_CHAT', 1, {
			channel: channelId,  // Отправка в приватный канал.
			authorID: 0,
			authorName: '',
			message: `<font color="#${color}"> ${pingValue} ms</font>`  // Форматируем вывод значения пинга с цветом.
		});
	}
	
	// Функция для регистрации хуков, сохраняет каждый хук в массив.
	function hook() {
		hooks.push(mod.hook(...arguments));  // Добавляем хук в массив для последующего удаления.
	}
	
	// Функция для удаления всех хуков.
	function unhookAll() {
		hooks.forEach(hook => mod.unhook(hook));  // Удаляем каждый зарегистрированный хук.
		hooks = [];  // Очищаем массив хуков.
	}
	
	// Обработчик события выхода из игры, удаляем все хуки и таймеры при выходе.
	mod.game.on('leave_game', () => {
		mod.clearTimeout(timeout);  // Очищаем таймер.
		unhookAll();  // Удаляем все хуки.
	});
};

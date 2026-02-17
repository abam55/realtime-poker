// Wrap everything in error handler
console.log('🎮 Poker game script loading...');

try {
    // Firebase Configuration
    const firebaseConfig = {
      apiKey: "AIzaSyCFiY4DBM-7RBI_5e2SaTTLnWlSxFKqPfs",
      authDomain: "poker-68ab2.firebaseapp.com",
      databaseURL: "https://poker-68ab2-default-rtdb.firebaseio.com",
      projectId: "poker-68ab2",
      storageBucket: "poker-68ab2.firebasestorage.app",
      messagingSenderId: "902045724137",
      appId: "1:902045724137:web:7929f45ed8799dd82cef78",
      measurementId: "G-ERB93RX8T0"
    };

    console.log('✓ Config loaded');

    // Initialize Firebase
    if (typeof firebase === 'undefined') {
        throw new Error('Firebase SDK not loaded! Check your internet connection.');
    }
    
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    console.log('✓ Firebase initialized');

    // Game State
    let gameId = null;
    let playerId = null;
    let playerName = null;
    let gameState = null;
    let cleanupInterval = null;

    // Game Settings
    const SMALL_BLIND = 10;
    const BIG_BLIND = 20;

    // Card deck
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    // UI Elements
    console.log('Getting UI elements...');
    
    const loginScreen = document.getElementById('loginScreen');
    const gameScreen = document.getElementById('gameScreen');
    const playerNameInput = document.getElementById('playerName');
    const createRoomBtn = document.getElementById('createRoomBtn');
    const showJoinBtn = document.getElementById('showJoinBtn');
    const createRoomOptions = document.getElementById('createRoomOptions');
    const joinRoomOptions = document.getElementById('joinRoomOptions');
    const maxPlayersSelect = document.getElementById('maxPlayersSelect');
    const roomCodeInput = document.getElementById('roomCodeInput');
    const confirmCreateBtn = document.getElementById('confirmCreateBtn');
    const confirmJoinBtn = document.getElementById('confirmJoinBtn');
    const cancelCreateBtn = document.getElementById('cancelCreateBtn');
    const cancelJoinBtn = document.getElementById('cancelJoinBtn');
    const leaveGameBtn = document.getElementById('leaveGameBtn');
    const waitingScreen = document.getElementById('waitingScreen');
    const startGameBtn = document.getElementById('startGameBtn');
    const actionPanel = document.getElementById('actionPanel');
    const communityCardsDiv = document.getElementById('communityCards');
    const playerCardsDiv = document.getElementById('playerCards');
    const playersContainer = document.getElementById('playersContainer');
    const logContainer = document.getElementById('logContainer');
    const betSlider = document.getElementById('betSlider');
    const betAmount = document.getElementById('betAmount');
    const foldBtn = document.getElementById('foldBtn');
    const checkBtn = document.getElementById('checkBtn');
    const callBtn = document.getElementById('callBtn');
    const raiseBtn = document.getElementById('raiseBtn');
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatContainer = document.getElementById('chatContainer');

    // Check if all elements exist
    const elements = {
        loginScreen, gameScreen, playerNameInput, createRoomBtn, showJoinBtn,
        createRoomOptions, joinRoomOptions, maxPlayersSelect, roomCodeInput,
        confirmCreateBtn, confirmJoinBtn, cancelCreateBtn, cancelJoinBtn,
        leaveGameBtn, waitingScreen, startGameBtn, actionPanel,
        communityCardsDiv, playerCardsDiv, playersContainer, logContainer,
        betSlider, betAmount, foldBtn, checkBtn, callBtn, raiseBtn,
        chatInput, sendChatBtn, chatContainer
    };

    for (const [name, element] of Object.entries(elements)) {
        if (!element) {
            console.error(`❌ Missing element: ${name}`);
        }
    }
    
    console.log('✓ UI elements loaded');

    // Event Listeners
    console.log('Setting up event listeners...');
    
    if (createRoomBtn) createRoomBtn.addEventListener('click', showCreateRoom);
    if (showJoinBtn) showJoinBtn.addEventListener('click', showJoinRoom);
    if (confirmCreateBtn) confirmCreateBtn.addEventListener('click', createRoom);
    if (confirmJoinBtn) confirmJoinBtn.addEventListener('click', joinRoom);
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', hideRoomOptions);
    if (cancelJoinBtn) cancelJoinBtn.addEventListener('click', hideRoomOptions);
    if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveGame);
    if (startGameBtn) startGameBtn.addEventListener('click', startGame);
    
    if (foldBtn) foldBtn.addEventListener('click', () => playerAction('fold'));
    if (checkBtn) checkBtn.addEventListener('click', () => playerAction('check'));
    if (callBtn) callBtn.addEventListener('click', () => playerAction('call'));
    if (raiseBtn) raiseBtn.addEventListener('click', () => playerAction('raise'));

    // Chat event listeners
    if (sendChatBtn) sendChatBtn.addEventListener('click', sendChatMessage);
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
    }

    // ===== Global Chat =====
    const globalChatInput = document.getElementById('globalChatInput');
    const globalSendBtn = document.getElementById('globalSendBtn');
    const globalChatMessages = document.getElementById('globalChatMessages');
    const globalOnlineCount = document.getElementById('globalOnlineCount');

    // Track global chat listener so we only attach once
    let globalChatListenerActive = false;
    // Track our own presence ref for cleanup
    let presenceRef = null;

    // Show placeholder when empty
    function checkGlobalChatEmpty() {
        const msgs = globalChatMessages.querySelectorAll('.global-msg');
        let empty = globalChatMessages.querySelector('.global-chat-empty');
        if (msgs.length === 0) {
            if (!empty) {
                empty = document.createElement('div');
                empty.className = 'global-chat-empty';
                empty.textContent = 'No messages yet. Say hi! 👋';
                globalChatMessages.appendChild(empty);
            }
        } else {
            if (empty) empty.remove();
        }
    }

    function initGlobalChat() {
        if (globalChatListenerActive) return;
        globalChatListenerActive = true;

        checkGlobalChatEmpty();

        // Listen for new global messages (last 60 stored, load last 60 on init)
        database.ref('globalChat').limitToLast(60).on('child_added', (snapshot) => {
            const msg = snapshot.val();
            if (!msg) return;
            renderGlobalMessage(msg);
            checkGlobalChatEmpty();
        });

        // Online presence
        updatePresence();
        database.ref('globalPresence').on('value', (snap) => {
            const data = snap.val() || {};
            const count = Object.keys(data).length;
            if (globalOnlineCount) {
                globalOnlineCount.textContent = `● ${count} online`;
            }
        });
    }

    function updatePresence() {
        const name = (playerNameInput && playerNameInput.value.trim()) || 'Guest';
        // Use a persistent anonymous ID per session
        if (!window._globalPresenceId) {
            window._globalPresenceId = 'p_' + Math.random().toString(36).substr(2, 9);
        }
        const pid = window._globalPresenceId;
        presenceRef = database.ref(`globalPresence/${pid}`);
        presenceRef.set({ name, active: true, ts: Date.now() });
        presenceRef.onDisconnect().remove();
    }

    function renderGlobalMessage(msg) {
        const isOwn = msg.senderId === window._globalPresenceId;
        const div = document.createElement('div');
        div.className = 'global-msg' + (isOwn ? ' own-global-msg' : '');

        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
            <div class="global-msg-header">
                <span class="global-msg-sender">${escapeHtml(msg.sender)}</span>
                <span class="global-msg-time">${time}</span>
            </div>
            <span class="global-msg-text">${escapeHtml(msg.text)}</span>
        `;
        globalChatMessages.appendChild(div);
        globalChatMessages.scrollTop = globalChatMessages.scrollHeight;
    }

    async function sendGlobalMessage() {
        const text = globalChatInput.value.trim();
        if (!text) return;
        const sender = (playerNameInput && playerNameInput.value.trim()) || 'Guest';
        if (!window._globalPresenceId) {
            window._globalPresenceId = 'p_' + Math.random().toString(36).substr(2, 9);
        }
        globalChatInput.value = '';
        try {
            await database.ref('globalChat').push({
                sender,
                senderId: window._globalPresenceId,
                text,
                timestamp: Date.now()
            });
            // Keep only last 200 messages to avoid unbounded growth
            const snap = await database.ref('globalChat').once('value');
            const keys = Object.keys(snap.val() || {});
            if (keys.length > 200) {
                const toDelete = keys.slice(0, keys.length - 200);
                const updates = {};
                toDelete.forEach(k => updates[`globalChat/${k}`] = null);
                await database.ref().update(updates);
            }
        } catch (err) {
            console.error('Error sending global message:', err);
        }
    }

    if (globalSendBtn) globalSendBtn.addEventListener('click', sendGlobalMessage);
    if (globalChatInput) {
        globalChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendGlobalMessage();
        });
        // Update presence name when they type their name
        globalChatInput.addEventListener('focus', () => updatePresence());
    }

    // Init global chat immediately
    initGlobalChat();

    console.log('✓ All event listeners set up');

    // Start automatic cleanup of empty rooms
    startRoomCleanup();
    console.log('✓ Room cleanup started');

    console.log('🎮 Poker game ready!');

    // Show Create Room Interface
    function showCreateRoom() {
        const name = playerNameInput.value.trim();
        if (!name) {
            document.getElementById('loginError').textContent = 'Please enter your name first';
            return;
        }
        
        hideRoomOptions();
        createRoomOptions.classList.remove('hidden');
    }

    // Show Join Room Interface
    function showJoinRoom() {
        const name = playerNameInput.value.trim();
        if (!name) {
            document.getElementById('loginError').textContent = 'Please enter your name first';
            return;
        }
        
        hideRoomOptions();
        joinRoomOptions.classList.remove('hidden');
    }

    // Hide Room Options
    function hideRoomOptions() {
        createRoomOptions.classList.add('hidden');
        joinRoomOptions.classList.add('hidden');
        document.getElementById('loginError').textContent = '';
    }

    // Generate 6-digit room code
    function generateRoomCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    // Create Room
    async function createRoom() {
        const name = playerNameInput.value.trim();
        if (!name) {
            document.getElementById('loginError').textContent = 'Please enter your name';
            return;
        }

        const maxPlayers = parseInt(maxPlayersSelect.value);
        playerName = name;
        playerId = generateId();
        gameId = generateRoomCode();

        try {
            // Check if room code already exists
            const existingRoom = await database.ref(`games/${gameId}`).once('value');
            if (existingRoom.exists()) {
                gameId = generateRoomCode();
            }

            // Create new game room
            await database.ref(`games/${gameId}`).set({
                status: 'waiting',
                players: {},
                pot: 0,
                communityCards: [],
                currentPlayerIndex: 0,
                dealerIndex: 0,
                round: 'preflop',
                currentBet: 0,
                maxPlayers: maxPlayers,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                playersActed: {},
                chat: {}
            });

            // Add player to game
            await database.ref(`games/${gameId}/players/${playerId}`).set({
                name: playerName,
                chips: 1000,
                bet: 0,
                cards: [],
                folded: false,
                isActive: true,
                joinedAt: Date.now()
            });

            // Store player info in localStorage
            localStorage.setItem('pokerId', playerId);
            localStorage.setItem('pokerGameId', gameId);

            // Setup presence tracking
            setupPresenceTracking();

            // Listen to game updates
            listenToGame();

            // Listen to chat updates
            listenToChat();

            // Switch to game screen
            loginScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            document.getElementById('gameCode').textContent = gameId;
            
            addLog(`Room created! Share code: ${gameId}`);
        } catch (error) {
            console.error('Error creating room:', error);
            document.getElementById('loginError').textContent = 'Error creating room: ' + error.message;
        }
    }

    // Join Room
    async function joinRoom() {
        const name = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim().toUpperCase();
        
        if (!name) {
            document.getElementById('loginError').textContent = 'Please enter your name';
            return;
        }
        
        if (!roomCode || roomCode.length !== 6) {
            document.getElementById('loginError').textContent = 'Please enter a valid 6-digit room code';
            return;
        }

        playerName = name;
        gameId = roomCode;

        try {
            // Check if room exists
            const gameSnapshot = await database.ref(`games/${gameId}`).once('value');
            if (!gameSnapshot.exists()) {
                document.getElementById('loginError').textContent = 'Room not found. Please check the code.';
                return;
            }

            const game = gameSnapshot.val();
            
            // Check if game is full
            const currentPlayers = Object.keys(game.players || {}).length;
            if (currentPlayers >= game.maxPlayers) {
                document.getElementById('loginError').textContent = `Room is full (${game.maxPlayers} players max)`;
                return;
            }

            // Check if game already started
            if (game.status !== 'waiting') {
                document.getElementById('loginError').textContent = 'Game already in progress';
                return;
            }

            // Generate player ID
            playerId = generateId();

            // Add player to game
            await database.ref(`games/${gameId}/players/${playerId}`).set({
                name: playerName,
                chips: 1000,
                bet: 0,
                cards: [],
                folded: false,
                isActive: true,
                joinedAt: Date.now()
            });

            // Store player info in localStorage
            localStorage.setItem('pokerId', playerId);
            localStorage.setItem('pokerGameId', gameId);

            // Setup presence tracking
            setupPresenceTracking();

            // Listen to game updates
            listenToGame();

            // Listen to chat updates
            listenToChat();

            // Switch to game screen
            loginScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
            document.getElementById('gameCode').textContent = gameId;
            
            addLog(`${playerName} joined the room`);
        } catch (error) {
            console.error('Error joining room:', error);
            document.getElementById('loginError').textContent = 'Error joining room: ' + error.message;
        }
    }

    // Setup presence tracking
    function setupPresenceTracking() {
        const playerRef = database.ref(`games/${gameId}/players/${playerId}`);
        const connectedRef = database.ref('.info/connected');
        
        connectedRef.on('value', (snapshot) => {
            if (snapshot.val() === true) {
                playerRef.onDisconnect().remove();
            }
        });
    }

    // Listen to Game Updates
    function listenToGame() {
        database.ref(`games/${gameId}`).on('value', (snapshot) => {
            gameState = snapshot.val();
            if (gameState) {
                updateUI();
            } else {
                // Game was deleted, return to login
                leaveGame(true);
            }
        });
    }

    // Listen to Chat Updates
    function listenToChat() {
        database.ref(`games/${gameId}/chat`).on('child_added', (snapshot) => {
            const message = snapshot.val();
            displayChatMessage(message);
        });
    }

    // Send Chat Message
    async function sendChatMessage() {
        const message = chatInput.value.trim();
        if (!message || !gameId || !playerId) return;

        try {
            const chatRef = database.ref(`games/${gameId}/chat`).push();
            await chatRef.set({
                senderId: playerId,
                senderName: playerName,
                message: message,
                timestamp: Date.now()
            });

            chatInput.value = '';
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    // Display Chat Message
    function displayChatMessage(msgData) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        if (msgData.senderId === playerId) {
            messageDiv.classList.add('own-message');
        }

        const time = new Date(msgData.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        messageDiv.innerHTML = `
            <span class="sender">${msgData.senderName}:</span>
            <span class="message-text">${escapeHtml(msgData.message)}</span>
            <span class="timestamp">${time}</span>
        `;

        chatContainer.appendChild(messageDiv);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Update UI
    function updateUI() {
        if (!gameState) return;

        const players = gameState.players || {};
        const playerIds = Object.keys(players);
        
        // Update player count
        const maxPlayers = gameState.maxPlayers;
        document.getElementById('playerCount').textContent = `${playerIds.length}/${maxPlayers}`;

        // GAME OVER screen
        const gameOverEl = document.getElementById('gameOverScreen');
        if (gameState.status === 'gameover') {
            waitingScreen.classList.add('hidden');
            actionPanel.classList.add('hidden');
            if (!gameOverEl) {
                const overlay = document.createElement('div');
                overlay.id = 'gameOverScreen';
                overlay.className = 'waiting-screen game-over-screen';
                const winnerId = gameState.gameWinner;
                const winnerName = winnerId && players[winnerId] ? players[winnerId].name : 'Someone';
                const isWinner = winnerId === playerId;
                overlay.innerHTML =
                    '<div class="crown-icon">\u{1F451}</div>' +
                    '<h2 class="' + (isWinner ? 'winner-text' : '') + '">' + winnerName + ' wins the game!</h2>' +
                    '<p style="margin:10px 0;opacity:0.8;">All other players are bankrupt.</p>' +
                    '<button id="playAgainBtn" class="start-btn play-again-btn">\u{1F504} Play Again (Reset $1000)</button>';
                document.querySelector('.poker-table').appendChild(overlay);
                document.getElementById('playAgainBtn').addEventListener('click', playAgain);
            }
            updatePlayers(players);
            updateWinnerHighlight();
            return;
        }

        // Remove game-over screen and ALL winner decorations when leaving gameover state
        if (gameOverEl) gameOverEl.remove();
        // Always strip winner glow/crown from local player's hand section when not in gameover
        const myHandSection = document.querySelector('.player-hand');
        if (myHandSection) myHandSection.classList.remove('game-winner-me');
        const existingCrown = document.getElementById('myWinnerLabel');
        if (existingCrown) existingCrown.remove();

        // Show/hide waiting screen
        if (gameState.status === 'waiting') {
            waitingScreen.classList.remove('hidden');
            actionPanel.classList.add('hidden');
            
            // Show start button only to the first player
            const isFirstPlayer = playerIds[0] === playerId;
            const hasEnoughPlayers = playerIds.length >= 2;
            
            if (isFirstPlayer && hasEnoughPlayers) {
                startGameBtn.classList.remove('hidden');
            } else {
                startGameBtn.classList.add('hidden');
            }
        } else {
            waitingScreen.classList.add('hidden');
        }

        // Update pot
        document.getElementById('potAmount').textContent = gameState.pot || 0;

        // Update community cards
        updateCommunityCards(gameState.communityCards || []);

        // Update players display
        updatePlayers(players);

        // Update current player's hand
        const currentPlayer = players[playerId];
        if (currentPlayer) {
            updatePlayerHand(currentPlayer.cards || []);
            document.getElementById('playerChips').textContent = currentPlayer.chips || 0;
        }

        // Update action panel
        updateActionPanel();
    }

    // Update Community Cards
    function updateCommunityCards(cards) {
        communityCardsDiv.innerHTML = '';
        
        // Show 5 card positions
        for (let i = 0; i < 5; i++) {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card';
            
            if (cards[i]) {
                const card = cards[i];
                cardDiv.textContent = card.rank + card.suit;
                cardDiv.classList.add(card.suit === '♥' || card.suit === '♦' ? 'red' : 'black');
            } else {
                cardDiv.classList.add('card-back');
            }
            
            communityCardsDiv.appendChild(cardDiv);
        }
    }

    // Update Player Hand
    function updatePlayerHand(cards) {
        playerCardsDiv.innerHTML = '';
        
        for (let i = 0; i < 2; i++) {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'card';
            
            if (cards[i]) {
                const card = cards[i];
                cardDiv.textContent = card.rank + card.suit;
                cardDiv.classList.add(card.suit === '♥' || card.suit === '♦' ? 'red' : 'black');
            } else {
                cardDiv.classList.add('card-back');
            }
            
            playerCardsDiv.appendChild(cardDiv);
        }

        // Show own hand name during showdown
        const myPlayer = gameState && gameState.players && gameState.players[playerId];
        const existingLabel = document.getElementById('myHandName');
        if (existingLabel) existingLabel.remove();

        if (myPlayer && myPlayer.handName && !myPlayer.folded) {
            const label = document.createElement('div');
            label.id = 'myHandName';
            label.style.cssText = 'margin-top:8px; font-size:0.95em; color:#90EE90; font-weight:bold;';
            label.textContent = '🃏 ' + myPlayer.handName;
            playerCardsDiv.parentElement.appendChild(label);
        }
    }

    // Update Players Display
    function updatePlayers(players) {
        playersContainer.innerHTML = '';
        const winnerId = gameState && gameState.gameWinner;

        Object.entries(players).forEach(([id, player]) => {
            if (id === playerId) return; // Skip current player
            
            const playerBox = document.createElement('div');
            playerBox.className = 'player-box';
            
            if (player.folded) {
                playerBox.classList.add('folded');
            }
            
            // Highlight current turn
            if (gameState.status === 'playing' && isPlayerTurn(id)) {
                playerBox.classList.add('active');
            }

            // Crown the game winner — only glow during gameover screen
            const isGameWinner = winnerId && winnerId === id;
            if (isGameWinner && gameState.status === 'gameover') {
                playerBox.classList.add('game-winner');
            }
            
            const currentRoundBet = player.bet || 0;

            // Build revealed cards HTML if available
            let revealedHTML = '';
            if (player.revealedCards && player.revealedCards.length > 0) {
                const cardsHTML = player.revealedCards.map(c => {
                    const colorClass = (c.suit === '\u2665' || c.suit === '\u2666') ? 'red' : 'black';
                    return '<div class="mini-card ' + colorClass + '">' + c.rank + c.suit + '</div>';
                }).join('');
                revealedHTML = '<div class="revealed-cards">' + cardsHTML + '</div>' +
                    (player.handName ? '<div class="hand-name">🃏 ' + player.handName + '</div>' : '');
            }

            // Badge logic
            const potIsEmpty = !gameState.pot || gameState.pot === 0;
            const isObserver = !!player.observer;
            const isLoser = !!player.loser;

            let statusBadge = '';
            if (isObserver && gameState.status !== 'gameover') {
                // Bankrupt observer sitting out
                statusBadge = '<div class="status broke-label">Observing 👀</div>';
            } else if (isLoser && potIsEmpty && gameState.status !== 'gameover') {
                // Lost all chips this hand, post-showdown
                statusBadge = '<div class="status loser-badge">Broke 💀</div>';
            } else if (player.chips === 0 && !potIsEmpty && !player.folded && !isObserver) {
                // Mid-hand all-in (only for active players in this hand)
                statusBadge = '<div class="status allin-badge">ALL IN 🔥</div>';
            }

            // Crown only shown during gameover status
            const crownLabel = (isGameWinner && gameState.status === 'gameover')
                ? '<div class="crown-label">👑 CHAMPION</div>' : '';
            
            playerBox.innerHTML =
                '<h4>' + player.name + '</h4>' +
                '<div class="chips">💰 $' + player.chips + '</div>' +
                (currentRoundBet > 0 ? '<div class="bet">Current Bet: $' + currentRoundBet + '</div>' : '') +
                (player.folded ? '<div class="status">Folded</div>' : '') +
                statusBadge +
                crownLabel +
                revealedHTML;
            
            playersContainer.appendChild(playerBox);
        });
    }

    // Highlight local player's own box if they are the game winner
    function updateWinnerHighlight() {
        const winnerId = gameState && gameState.gameWinner;
        const myHandSection = document.querySelector('.player-hand');
        if (!myHandSection) return;
        const existingCrown = document.getElementById('myWinnerLabel');
        if (existingCrown) existingCrown.remove();
        if (winnerId === playerId && gameState.status === 'gameover') {
            myHandSection.classList.add('game-winner-me');
            const label = document.createElement('div');
            label.id = 'myWinnerLabel';
            label.className = 'crown-label';
            label.textContent = '👑 YOU ARE THE CHAMPION!';
            myHandSection.appendChild(label);
        } else {
            myHandSection.classList.remove('game-winner-me');
        }
    }

    // Update Action Panel
    function updateActionPanel() {
        if (gameState.status !== 'playing') {
            actionPanel.classList.add('hidden');
            return;
        }

        const currentPlayer = gameState.players[playerId];
        if (!currentPlayer || currentPlayer.folded) {
            actionPanel.classList.add('hidden');
            return;
        }

        // If this player has no chips left they are all-in — no actions possible
        if (currentPlayer.chips === 0) {
            actionPanel.classList.add('hidden');
            return;
        }

        if (isMyTurn()) {
            actionPanel.classList.remove('hidden');

            const currentBet = gameState.currentBet || 0;
            const myBet = currentPlayer.bet || 0;
            const callAmount = Math.max(0, currentBet - myBet);
            const availableChips = currentPlayer.chips;

            // Detect if there is an all-in situation facing us:
            // someone bet more than they had chips for (their chips === 0 now)
            const players = gameState.players;
            const anyoneAllIn = Object.values(players).some(p => !p.folded && p.chips === 0);

            if (anyoneAllIn && callAmount > 0) {
                // All-in scenario: only Fold or Call allowed
                document.getElementById('callAmount').textContent = Math.min(callAmount, availableChips);
                callBtn.disabled = false;
                checkBtn.disabled = true;
                raiseBtn.disabled = true;
                betSlider.disabled = true;
                betAmount.textContent = '$0';
            } else if (callAmount > 0) {
                // Normal bet to call
                document.getElementById('callAmount').textContent = callAmount;
                callBtn.disabled = availableChips <= 0;
                checkBtn.disabled = true;

                const canRaise = availableChips > callAmount;
                raiseBtn.disabled = !canRaise;
                betSlider.disabled = !canRaise;

                if (canRaise) {
                    const minRaise = currentBet + BIG_BLIND;
                    const maxRaise = myBet + availableChips;
                    betSlider.min = minRaise;
                    betSlider.max = maxRaise;
                    betSlider.step = 10;
                    betSlider.value = Math.min(minRaise, maxRaise);
                    updateBetAmount();
                }
            } else {
                // No bet outstanding — check or raise
                document.getElementById('callAmount').textContent = 0;
                callBtn.disabled = true;
                checkBtn.disabled = false;

                const canRaise = availableChips > 0;
                raiseBtn.disabled = !canRaise;
                betSlider.disabled = !canRaise;

                if (canRaise) {
                    const minRaise = currentBet + BIG_BLIND;
                    const maxRaise = myBet + availableChips;
                    betSlider.min = minRaise;
                    betSlider.max = maxRaise;
                    betSlider.step = 10;
                    betSlider.value = Math.min(minRaise, maxRaise);
                    updateBetAmount();
                }
            }
        } else {
            actionPanel.classList.add('hidden');
        }
    }

    // Check if it's player's turn — uses currentTurnPlayerId (never index-based)
    function isMyTurn() {
        if (!gameState || gameState.status !== 'playing') return false;
        return gameState.currentTurnPlayerId === playerId;
    }

    // Check if it's a specific player's turn
    function isPlayerTurn(checkPlayerId) {
        return gameState.currentTurnPlayerId === checkPlayerId;
    }

    // Get all player IDs who can still act this hand (not folded, have chips)
    function getActivePlayerIds() {
        return Object.keys(gameState.players).filter(id => {
            const p = gameState.players[id];
            return !p.folded && p.chips > 0;
        });
    }

    // Given the current turn player, find the next player who can act
    function getNextTurnPlayerId(afterPlayerId, players) {
        const allIds = Object.keys(players);
        const startIndex = allIds.indexOf(afterPlayerId);
        // Walk forward through all players (wrapping) to find next who can act
        for (let i = 1; i <= allIds.length; i++) {
            const nextId = allIds[(startIndex + i) % allIds.length];
            const p = players[nextId];
            if (!p.folded && p.chips > 0) {
                return nextId;
            }
        }
        return null; // everyone else is all-in or folded
    }

    // Update Bet Amount Display
    function updateBetAmount() {
        const amount = parseInt(betSlider.value) || 0;
        betAmount.textContent = '$' + amount;
    }
    
    // Add event listeners for slider
    if (betSlider) {
        betSlider.addEventListener('change', updateBetAmount);
        betSlider.addEventListener('input', updateBetAmount);
    }

    // Player Action
    async function playerAction(action) {
        if (!isMyTurn()) return;

        console.log(`Player action: ${action}`);

        const updates = {};
        const currentPlayer = gameState.players[playerId];
        const currentBet = gameState.currentBet || 0;
        const myBet = currentPlayer.bet || 0;
        const playerIds = getActivePlayerIds();

        switch (action) {
            case 'fold':
                // Prevent double-folding
                if (currentPlayer.folded) return;
                
                updates[`games/${gameId}/players/${playerId}/folded`] = true;
                addLog(`${playerName} folded`);
                
                // Check if only one non-folded player remains after this fold
                const remainingActive = Object.keys(gameState.players).filter(id => {
                    if (id === playerId) return false; // this player is folding
                    return !gameState.players[id].folded;
                });
                if (remainingActive.length === 1) {
                    await database.ref().update(updates);
                    setTimeout(() => awardPotToPlayer(remainingActive[0]), 1000);
                    return;
                }
                break;

            case 'check':
                if (currentBet > myBet) {
                    console.error('Cannot check - there is a bet to call');
                    return;
                }
                addLog(`${playerName} checked`);
                break;

            case 'call':
                const callAmount = currentBet - myBet;
                if (callAmount > 0) {
                    // Player may not have enough chips to fully cover — cap at what they have
                    const actualCall = Math.min(callAmount, currentPlayer.chips);
                    updates[`games/${gameId}/players/${playerId}/chips`] = currentPlayer.chips - actualCall;
                    updates[`games/${gameId}/players/${playerId}/bet`] = myBet + actualCall;
                    updates[`games/${gameId}/pot`] = (gameState.pot || 0) + actualCall;
                    if (actualCall < callAmount) {
                        addLog(`${playerName} called all-in for $${actualCall}`);
                    } else {
                        addLog(`${playerName} called $${actualCall}`);
                    }
                }
                break;

            case 'raise':
                const totalRaiseAmount = parseInt(betSlider.value);
                
                if (totalRaiseAmount <= currentBet) {
                    console.error('Raise amount must be more than current bet');
                    return;
                }
                
                const amountToAdd = totalRaiseAmount - myBet;
                const actualAmountToAdd = Math.min(amountToAdd, currentPlayer.chips);
                
                updates[`games/${gameId}/players/${playerId}/chips`] = currentPlayer.chips - actualAmountToAdd;
                updates[`games/${gameId}/players/${playerId}/bet`] = myBet + actualAmountToAdd;
                updates[`games/${gameId}/pot`] = (gameState.pot || 0) + actualAmountToAdd;
                updates[`games/${gameId}/currentBet`] = myBet + actualAmountToAdd;
                
                // When someone raises, reset playersActed — only players who still have chips after this raise
                const chipsAfterRaise = currentPlayer.chips - actualAmountToAdd;
                const newPlayersActed = {};
                Object.keys(gameState.players).forEach(id => {
                    const p = gameState.players[id];
                    if (!p.folded) {
                        // Include if they have chips now, OR if they are the raiser who may have just gone all-in
                        const chips = (id === playerId) ? chipsAfterRaise : p.chips;
                        if (chips > 0) {
                            newPlayersActed[id] = (id === playerId);
                        }
                    }
                });
                updates[`games/${gameId}/playersActed`] = newPlayersActed;
                
                const newTotalBet = myBet + actualAmountToAdd;
                const remainingAfterRaise = currentPlayer.chips - actualAmountToAdd;
                if (remainingAfterRaise === 0) {
                    addLog(`${playerName} goes ALL-IN for $${newTotalBet}!`);
                } else {
                    addLog(`${playerName} raised to $${newTotalBet}`);
                }
                break;
        }

        // Mark this player as having acted (except for raise which handles it specially)
        if (action !== 'raise') {
            const currentPlayersActed = gameState.playersActed || {};
            const updatedPlayersActed = { ...currentPlayersActed };
            updatedPlayersActed[playerId] = true;
            updates[`games/${gameId}/playersActed`] = updatedPlayersActed;
        }

        // Find the next player who can act, accounting for the chips this action may have spent
        // We need to compute the updated player state to get next turn right
        const updatedPlayers = JSON.parse(JSON.stringify(gameState.players));
        // Apply chip changes from this action to our local copy before computing next
        if (updates[`games/${gameId}/players/${playerId}/chips`] !== undefined) {
            updatedPlayers[playerId].chips = updates[`games/${gameId}/players/${playerId}/chips`];
        }
        if (updates[`games/${gameId}/players/${playerId}/folded`] !== undefined) {
            updatedPlayers[playerId].folded = updates[`games/${gameId}/players/${playerId}/folded`];
        }
        const nextTurnId = getNextTurnPlayerId(playerId, updatedPlayers);
        updates[`games/${gameId}/currentTurnPlayerId`] = nextTurnId;
        // Keep currentPlayerIndex in sync for any legacy reads (set to 0, unused)
        updates[`games/${gameId}/currentPlayerIndex`] = 0;

        await database.ref().update(updates);

        // Check if betting round is complete
        setTimeout(() => checkBettingRoundComplete(), 1000);
    }

    // Check if betting round is complete
    async function checkBettingRoundComplete() {
        const snapshot = await database.ref(`games/${gameId}`).once('value');
        const state = snapshot.val();
        if (!state) return;

        const players = state.players;
        const activePlayers = Object.entries(players).filter(([id, p]) => !p.folded);
        // Players who can still take actions (have chips remaining)
        const actingPlayers = activePlayers.filter(([id, p]) => p.chips > 0);

        // Only one (or zero) players left — end hand
        if (activePlayers.length <= 1) {
            advanceRound();
            return;
        }

        // Everyone still in is all-in — flip all remaining cards immediately then showdown
        if (actingPlayers.length === 0) {
            await runOutAllCards(state);
            return;
        }

        // Check if all players who CAN act have acted
        const playersActed = state.playersActed || {};
        const allActed = actingPlayers.every(([id]) => playersActed[id] === true);
        if (!allActed) return;

        // Check all bets are matched (or player is all-in)
        const currentBet = state.currentBet || 0;
        const allBetsMatched = activePlayers.every(([id, p]) => {
            return p.bet >= currentBet || p.chips === 0;
        });
        if (!allBetsMatched) return;

        // After call, check if everyone who just acted is now all-in
        // If so, run out remaining cards straight to showdown
        const nowActing = activePlayers.filter(([id, p]) => p.chips > 0);
        if (nowActing.length === 0) {
            await runOutAllCards(state);
            return;
        }

        advanceRound();
    }

    // Immediately deal all remaining community cards then go straight to showdown
    async function runOutAllCards(state) {
        const rounds = ['preflop', 'flop', 'turn', 'river'];
        let currentRound = state.round;
        let deck = state.deck;
        let deckIndex = state.deckIndex || 0;
        let communityCards = [...(state.communityCards || [])];
        const updates = {};

        // Deal whatever cards are still needed
        if (currentRound === 'preflop') {
            communityCards.push(deck[deckIndex], deck[deckIndex+1], deck[deckIndex+2]);
            deckIndex += 3;
            currentRound = 'flop';
        }
        if (currentRound === 'flop') {
            communityCards.push(deck[deckIndex]);
            deckIndex += 1;
            currentRound = 'turn';
        }
        if (currentRound === 'turn') {
            communityCards.push(deck[deckIndex]);
            deckIndex += 1;
            currentRound = 'river';
        }

        updates[`games/${gameId}/communityCards`] = communityCards;
        updates[`games/${gameId}/deckIndex`] = deckIndex;
        updates[`games/${gameId}/round`] = 'river';
        updates[`games/${gameId}/currentBet`] = 0;

        await database.ref().update(updates);
        addLog('All-in! Running out remaining cards...');

        // Short pause so players can see the cards flip, then showdown
        await new Promise(resolve => setTimeout(resolve, 1500));
        await showdown();
    }

    // Advance to next round
    async function advanceRound() {
        const snapshot = await database.ref(`games/${gameId}`).once('value');
        const state = snapshot.val();
        if (!state) return;

        const rounds = ['preflop', 'flop', 'turn', 'river', 'showdown'];
        const currentRoundIndex = rounds.indexOf(state.round);
        const nextRound = rounds[currentRoundIndex + 1];

        if (!nextRound || nextRound === 'showdown') {
            // Go to showdown
            await showdown();
            return;
        }

        const updates = {};
        updates[`games/${gameId}/round`] = nextRound;
        updates[`games/${gameId}/currentBet`] = 0;
        
        // Reset all player bets to 0 for the new round
        const players = state.players;
        Object.keys(players).forEach(id => {
            if (!players[id].folded) {
                updates[`games/${gameId}/players/${id}/bet`] = 0;
            }
        });
        
        // Reset playersActed — only track players who can still act (have chips)
        const playersActed = {};
        Object.keys(players).forEach(id => {
            if (!players[id].folded && players[id].chips > 0) {
                playersActed[id] = false;
            }
        });
        updates[`games/${gameId}/playersActed`] = playersActed;
        // Set turn to first player who can act
        const firstActingId = Object.keys(players).find(id => !players[id].folded && players[id].chips > 0) || null;
        updates[`games/${gameId}/currentTurnPlayerId`] = firstActingId;
        updates[`games/${gameId}/currentPlayerIndex`] = 0;

        // Deal community cards based on round
        const deck = state.deck;
        let deckIndex = state.deckIndex || 0;
        const communityCards = [...(state.communityCards || [])];

        if (nextRound === 'flop') {
            communityCards.push(deck[deckIndex], deck[deckIndex + 1], deck[deckIndex + 2]);
            deckIndex += 3;
        } else if (nextRound === 'turn') {
            communityCards.push(deck[deckIndex]);
            deckIndex += 1;
        } else if (nextRound === 'river') {
            communityCards.push(deck[deckIndex]);
            deckIndex += 1;
        }

        updates[`games/${gameId}/communityCards`] = communityCards;
        updates[`games/${gameId}/deckIndex`] = deckIndex;

        await database.ref().update(updates);
        addLog(`Round: ${nextRound.toUpperCase()}`);
    }

    // Showdown - determine winner
    async function showdown() {
        const snapshot = await database.ref(`games/${gameId}`).once('value');
        const state = snapshot.val();
        if (!state) return;

        const players = state.players;
        const communityCards = state.communityCards || [];
        const activePlayers = Object.entries(players).filter(([id, p]) => !p.folded);

        if (activePlayers.length === 1) {
            await awardPotToPlayer(activePlayers[0][0]);
            return;
        }

        // Evaluate hands and write reveal data to Firebase for all active players
        const revealUpdates = {};
        let bestHandValue = -1;
        let winners = [];
        const handResults = [];

        for (const [id, player] of activePlayers) {
            const hand = evaluateHand([...player.cards, ...communityCards]);
            handResults.push({ id, player, hand });

            // Write cards + hand name so every client can display them
            revealUpdates[`games/${gameId}/players/${id}/revealedCards`] = player.cards;
            revealUpdates[`games/${gameId}/players/${id}/handName`] = hand.name;

            addLog(`${player.name} shows: ${hand.name}`);

            if (hand.value > bestHandValue) {
                bestHandValue = hand.value;
                winners = [id];
            } else if (hand.value === bestHandValue) {
                winners.push(id);
            }
        }

        // Push reveal data first so UI updates immediately
        await database.ref().update(revealUpdates);

        // Short pause so players can see cards before winner is announced
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Award pot to winner(s)
        const potShare = Math.floor(state.pot / winners.length);
        const winUpdates = {};

        for (const winnerId of winners) {
            const winner = players[winnerId];
            winUpdates[`games/${gameId}/players/${winnerId}/chips`] = winner.chips + potShare;
            addLog(`🏆 ${winner.name} wins $${potShare}!`);
        }

        await database.ref().update(winUpdates);

        // Re-read state after chips awarded to find who ended up at 0
        const afterSnap = await database.ref(`games/${gameId}/players`).once('value');
        const afterPlayers = afterSnap.val() || {};
        const loserUpdates = {};
        for (const [id, p] of Object.entries(afterPlayers)) {
            if (p.chips === 0 && !p.folded) {
                loserUpdates[`games/${gameId}/players/${id}/loser`] = true;
            }
        }
        if (Object.keys(loserUpdates).length > 0) {
            await database.ref().update(loserUpdates);
        }

        // Reset game after 5 seconds
        setTimeout(() => resetGame(), 5000);
    }

    // Award pot to a single player (when others fold)
    async function awardPotToPlayer(winnerId) {
        const snapshot = await database.ref(`games/${gameId}`).once('value');
        const state = snapshot.val();
        if (!state) return;

        const winner = state.players[winnerId];
        const pot = state.pot || 0;

        await database.ref(`games/${gameId}/players/${winnerId}/chips`).set(winner.chips + pot);
        addLog(`🏆 ${winner.name} wins $${pot}!`);
        
        setTimeout(() => resetGame(), 3000);
    }

    // Evaluate poker hand
    function evaluateHand(cards) {
        // Convert cards to a format easier to work with
        const cardValues = cards.map(c => {
            let value = ranks.indexOf(c.rank);
            return { rank: value, suit: c.suit, rankName: c.rank };
        });

        // Sort by rank descending
        cardValues.sort((a, b) => b.rank - a.rank);

        // Check for flush
        const suitCounts = {};
        cardValues.forEach(c => suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1);
        const isFlush = Object.values(suitCounts).some(count => count >= 5);

        // Check for straight
        let isStraight = false;
        let straightHigh = 0;
        for (let i = 0; i <= cardValues.length - 5; i++) {
            let consecutive = 1;
            for (let j = i; j < cardValues.length - 1; j++) {
                if (cardValues[j].rank - cardValues[j + 1].rank === 1) {
                    consecutive++;
                    if (consecutive === 5) {
                        isStraight = true;
                        straightHigh = cardValues[i].rank;
                        break;
                    }
                } else if (cardValues[j].rank !== cardValues[j + 1].rank) {
                    break;
                }
            }
            if (isStraight) break;
        }

        // Check for A-2-3-4-5 straight (wheel)
        if (!isStraight && cardValues[0].rank === 12) { // Ace
            const lowRanks = cardValues.map(c => c.rank).slice(-4);
            if (lowRanks.join(',') === '3,2,1,0') {
                isStraight = true;
                straightHigh = 3;
            }
        }

        // Count rank frequencies
        const rankCounts = {};
        cardValues.forEach(c => rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1);
        const counts = Object.values(rankCounts).sort((a, b) => b - a);

        // Determine hand ranking
        if (isStraight && isFlush) {
            return { value: 8000000 + straightHigh, name: 'Straight Flush' };
        }
        if (counts[0] === 4) {
            return { value: 7000000 + cardValues[0].rank, name: 'Four of a Kind' };
        }
        if (counts[0] === 3 && counts[1] >= 2) {
            return { value: 6000000 + cardValues[0].rank, name: 'Full House' };
        }
        if (isFlush) {
            return { value: 5000000 + cardValues[0].rank, name: 'Flush' };
        }
        if (isStraight) {
            return { value: 4000000 + straightHigh, name: 'Straight' };
        }
        if (counts[0] === 3) {
            return { value: 3000000 + cardValues[0].rank, name: 'Three of a Kind' };
        }
        if (counts[0] === 2 && counts[1] === 2) {
            return { value: 2000000 + cardValues[0].rank, name: 'Two Pair' };
        }
        if (counts[0] === 2) {
            return { value: 1000000 + cardValues[0].rank, name: 'Pair' };
        }
        return { value: cardValues[0].rank, name: 'High Card: ' + cardValues[0].rankName };
    }

    // Start Game
    async function startGame() {
        if (!gameState || !gameState.players) {
            alert('Error: Game state not loaded');
            return;
        }
        
        const playerCount = Object.keys(gameState.players).length;
        
        if (playerCount < 2) {
            alert('Need at least 2 players to start');
            return;
        }

        try {
            // Deal initial cards
            const deck = createDeck();
            const players = gameState.players;
            const playerIds = Object.keys(players);

            const updates = {};
            updates[`games/${gameId}/status`] = 'playing';
            updates[`games/${gameId}/round`] = 'preflop';
            updates[`games/${gameId}/currentPlayerIndex`] = 0;
            updates[`games/${gameId}/deck`] = deck;
            updates[`games/${gameId}/currentBet`] = BIG_BLIND;
            // currentTurnPlayerId will be set after blinds loop below

            const playersActed = {};

            // Deal 2 cards to each player
            let cardIndex = 0;
            let pot = 0;

            // Only deal to / charge blinds to players who have chips
            const activeDealIds = playerIds.filter(id => players[id].chips > 0);

            // Mark bankrupt players as observers (folded=true, no cards)
            playerIds.forEach(id => {
                if (players[id].chips <= 0) {
                    updates[`games/${gameId}/players/${id}/folded`] = true;
                    updates[`games/${gameId}/players/${id}/cards`] = [];
                    updates[`games/${gameId}/players/${id}/bet`] = 0;
                    updates[`games/${gameId}/players/${id}/observer`] = true;
                } else {
                    updates[`games/${gameId}/players/${id}/observer`] = false;
                }
            });

            activeDealIds.forEach((id, index) => {
                updates[`games/${gameId}/players/${id}/cards`] = [
                    deck[cardIndex++],
                    deck[cardIndex++]
                ];
                updates[`games/${gameId}/players/${id}/folded`] = false;

                // Initialize playersActed only for active players
                playersActed[id] = false;

                // Post blinds
                if (activeDealIds.length === 2) {
                    if (index === 0) {
                        const blind = Math.min(SMALL_BLIND, players[id].chips);
                        updates[`games/${gameId}/players/${id}/bet`] = blind;
                        updates[`games/${gameId}/players/${id}/chips`] = players[id].chips - blind;
                        pot += blind;
                    } else {
                        const blind = Math.min(BIG_BLIND, players[id].chips);
                        updates[`games/${gameId}/players/${id}/bet`] = blind;
                        updates[`games/${gameId}/players/${id}/chips`] = players[id].chips - blind;
                        pot += blind;
                    }
                } else {
                    if (index === 0) {
                        const blind = Math.min(SMALL_BLIND, players[id].chips);
                        updates[`games/${gameId}/players/${id}/bet`] = blind;
                        updates[`games/${gameId}/players/${id}/chips`] = players[id].chips - blind;
                        pot += blind;
                    } else if (index === 1) {
                        const blind = Math.min(BIG_BLIND, players[id].chips);
                        updates[`games/${gameId}/players/${id}/bet`] = blind;
                        updates[`games/${gameId}/players/${id}/chips`] = players[id].chips - blind;
                        pot += blind;
                    }
                }
            });

            updates[`games/${gameId}/playersActed`] = playersActed;
            updates[`games/${gameId}/pot`] = pot;
            updates[`games/${gameId}/deckIndex`] = cardIndex;
            // Set the first turn to the first player who has chips after blinds
            // First turn = first active (non-bankrupt) player who still has chips after blinds
            const firstTurnId = activeDealIds.find(id => {
                const chipVal = updates[`games/${gameId}/players/${id}/chips`];
                return chipVal !== undefined ? chipVal > 0 : players[id].chips > 0;
            }) || activeDealIds[0];
            updates[`games/${gameId}/currentTurnPlayerId`] = firstTurnId;

            await database.ref().update(updates);
            
            addLog('Game started! Good luck!');
            addLog(`Blinds: $${SMALL_BLIND}/$${BIG_BLIND}`);
        } catch (error) {
            console.error('Error starting game:', error);
            alert('Error starting game: ' + error.message);
        }
    }

    // Create Deck
    function createDeck() {
        const deck = [];
        for (let suit of suits) {
            for (let rank of ranks) {
                deck.push({ suit, rank });
            }
        }
        // Shuffle deck
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    // Reset Game
    async function resetGame() {
        const snapshot = await database.ref(`games/${gameId}`).once('value');
        const state = snapshot.val();
        if (!state) return;

        const updates = {};
        const players = state.players;
        
        // Count players who still have chips
        const playersWithChips = Object.entries(players).filter(([id, player]) => player.chips > 0);
        
        if (playersWithChips.length <= 1) {
            // ── GAME OVER ──
            if (playersWithChips.length === 1) {
                const [winnerId, winner] = playersWithChips[0];
                addLog(`👑 ${winner.name} is the CHAMPION!`);
                addLog('Game Over! All other players are bankrupt.');
                // Flag the winner in Firebase so all clients can crown them
                updates[`games/${gameId}/gameWinner`] = winnerId;
            }

            updates[`games/${gameId}/status`] = 'gameover';
            updates[`games/${gameId}/pot`] = 0;
            updates[`games/${gameId}/communityCards`] = [];
            updates[`games/${gameId}/currentBet`] = 0;
            updates[`games/${gameId}/round`] = 'preflop';
            updates[`games/${gameId}/playersActed`] = {};

            for (const [id] of Object.entries(players)) {
                updates[`games/${gameId}/players/${id}/cards`] = [];
                updates[`games/${gameId}/players/${id}/bet`] = 0;
                updates[`games/${gameId}/players/${id}/folded`] = false;
                updates[`games/${gameId}/players/${id}/revealedCards`] = null;
                updates[`games/${gameId}/players/${id}/handName`] = null;
                updates[`games/${gameId}/players/${id}/observer`] = null;
                updates[`games/${gameId}/players/${id}/loser`] = null;
            }

            await database.ref().update(updates);
            return;
        }
        
        // ── NEXT HAND ──
        addLog('Hand ended. Starting next hand in 3 seconds...');

        updates[`games/${gameId}/status`] = 'waiting';
        updates[`games/${gameId}/pot`] = 0;
        updates[`games/${gameId}/communityCards`] = [];
        updates[`games/${gameId}/currentBet`] = 0;
        updates[`games/${gameId}/round`] = 'preflop';
        updates[`games/${gameId}/playersActed`] = {};
        updates[`games/${gameId}/gameWinner`] = null;

        for (const [id, player] of Object.entries(players)) {
            if (player.chips <= 0) {
                addLog(`${player.name} is out of chips and will observe.`);
            }
            updates[`games/${gameId}/players/${id}/cards`] = [];
            updates[`games/${gameId}/players/${id}/bet`] = 0;
            updates[`games/${gameId}/players/${id}/folded`] = false;
            updates[`games/${gameId}/players/${id}/revealedCards`] = null;
            updates[`games/${gameId}/players/${id}/handName`] = null;
            updates[`games/${gameId}/players/${id}/loser`] = null;
            updates[`games/${gameId}/players/${id}/observer`] = player.chips <= 0;
        }

        await database.ref().update(updates);

        setTimeout(async () => {
            const checkSnapshot = await database.ref(`games/${gameId}`).once('value');
            const checkState = checkSnapshot.val();
            if (!checkState || checkState.status !== 'waiting') return;
            await startGame();
        }, 3000);
    }

    // Play Again — resets all chips to 1000 and goes back to waiting
    async function playAgain() {
        const snapshot = await database.ref(`games/${gameId}`).once('value');
        const state = snapshot.val();
        if (!state) return;

        const updates = {};
        updates[`games/${gameId}/status`] = 'waiting';
        updates[`games/${gameId}/pot`] = 0;
        updates[`games/${gameId}/communityCards`] = [];
        updates[`games/${gameId}/currentBet`] = 0;
        updates[`games/${gameId}/round`] = 'preflop';
        updates[`games/${gameId}/playersActed`] = {};
        updates[`games/${gameId}/gameWinner`] = null;

        for (const [id] of Object.entries(state.players)) {
            updates[`games/${gameId}/players/${id}/chips`] = 1000;
            updates[`games/${gameId}/players/${id}/cards`] = [];
            updates[`games/${gameId}/players/${id}/bet`] = 0;
            updates[`games/${gameId}/players/${id}/folded`] = false;
            updates[`games/${gameId}/players/${id}/revealedCards`] = null;
            updates[`games/${gameId}/players/${id}/handName`] = null;
            updates[`games/${gameId}/players/${id}/observer`] = false;
            updates[`games/${gameId}/players/${id}/loser`] = null;
        }

        await database.ref().update(updates);
        addLog('New game started! Everyone gets $1000. Good luck!');
    }

    // Add Log Entry
    function addLog(message) {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    // Leave Game
    async function leaveGame(silent = false) {
        if (gameId && playerId) {
            await database.ref(`games/${gameId}/players/${playerId}`).remove();
            database.ref(`games/${gameId}`).off();
            database.ref(`games/${gameId}/chat`).off();
        }
        
        // Clear stored game info
        localStorage.removeItem('pokerId');
        localStorage.removeItem('pokerGameId');
        
        gameScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
        playerNameInput.value = '';
        roomCodeInput.value = '';
        hideRoomOptions();
        
        gameId = null;
        playerId = null;
        gameState = null;
        
        // Clear chat
        if (chatContainer) {
            chatContainer.innerHTML = '';
        }
        if (chatInput) {
            chatInput.value = '';
        }
        // Clear any winner/game-over DOM artifacts
        const goScreen = document.getElementById('gameOverScreen');
        if (goScreen) goScreen.remove();
        const winLabel = document.getElementById('myWinnerLabel');
        if (winLabel) winLabel.remove();
        const handLabel = document.getElementById('myHandName');
        if (handLabel) handLabel.remove();
        document.querySelector('.player-hand')?.classList.remove('game-winner-me');
    }

    // Generate Random ID
    function generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    // Start Room Cleanup Process
    function startRoomCleanup() {
        cleanupInterval = setInterval(async () => {
            const gamesRef = database.ref('games');
            const snapshot = await gamesRef.once('value');
            const games = snapshot.val();
            
            if (!games) return;
            
            const now = Date.now();
            const EMPTY_ROOM_TIMEOUT = 5 * 60 * 1000;
            const INACTIVE_TIMEOUT = 30 * 60 * 1000;
            
            for (const [roomId, game] of Object.entries(games)) {
                const players = game.players || {};
                const playerCount = Object.keys(players).length;
                const lastActivity = game.lastActivity || game.createdAt || 0;
                const timeSinceActivity = now - lastActivity;
                
                if (playerCount === 0 && timeSinceActivity > EMPTY_ROOM_TIMEOUT) {
                    await database.ref(`games/${roomId}`).remove();
                } else if (timeSinceActivity > INACTIVE_TIMEOUT) {
                    await database.ref(`games/${roomId}`).remove();
                }
            }
        }, 30000);
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (gameId && playerId) {
            database.ref(`games/${gameId}/players/${playerId}`).remove();
        }
        if (cleanupInterval) {
            clearInterval(cleanupInterval);
        }
    });

} catch (error) {
    console.error('❌ FATAL ERROR:', error);
    alert('Failed to load game: ' + error.message + '\n\nCheck console for details (F12)');
}



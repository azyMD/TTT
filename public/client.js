const socket = io();

// DOM references
const loginScreen      = document.getElementById('login-screen');
const lobbyScreen      = document.getElementById('lobby-screen');
const gameScreen       = document.getElementById('game-screen');

const usernameInput    = document.getElementById('username');
const loginBtn         = document.getElementById('login-btn');
const telegramLoginBtn = document.getElementById('telegram-login-btn');

const currentUsernameSpan = document.getElementById('current-username');
const statsBadge          = document.getElementById('stats-badge');
const statsPopup          = document.getElementById('stats-popup');

const playersList    = document.getElementById('players-list');
const playBotBtn     = document.getElementById('play-bot-btn');
const turnIndicator  = document.getElementById('turn-indicator');
const quitGameBtn    = document.getElementById('quit-game-btn');
const statusMsg      = document.getElementById('status-msg');
const replayBtn      = document.getElementById('replay-btn');
const boardDiv       = document.getElementById('board');

let currentGameId = null;
let mySymbol      = null;
let myTurn        = false;

// Switch visible screen
function showScreen(screen) {
  [loginScreen, lobbyScreen, gameScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// ---------------- LOGIN FLOW ----------------
loginBtn.onclick = async () => {
  const username = usernameInput.value.trim();
  if (!username) {
    return alert('Please enter a username.');
  }

  try {
    const res = await fetch(`/login?username=${username}`);
    const data = await res.json();
    if (data.success) {
      // Store user name in header
      currentUsernameSpan.textContent = data.user.username;
      showScreen(lobbyScreen);
      socket.emit('joinLobby', data.user.username);
    } else {
      alert('Login failed.');
    }
  } catch (err) {
    console.error('Login Error:', err);
  }
};

// Placeholder Telegram login
telegramLoginBtn.onclick = async () => {
  try {
    const res = await fetch('/telegram-login');
    const data = await res.json();
    if (data.success) {
      currentUsernameSpan.textContent = data.user.username;
      showScreen(lobbyScreen);
      socket.emit('joinLobby', data.user.username);
    }
  } catch (err) {
    console.error('Telegram Login Error:', err);
  }
};

// ---------------- LOBBY ----------------
socket.on('lobbyUpdate', (userList) => {
  playersList.innerHTML = '';
  userList.forEach((u) => {
    // Skip ourselves
    if (u.socketId === socket.id) return;

    const div = document.createElement('div');
    div.classList.add('player-item');

    div.textContent = u.username;
    if (u.status === 'in-game') {
      div.classList.add('player-in-game');
    } else {
      div.classList.add('player-available');
      // Challenge on click
      div.onclick = () => {
        socket.emit('challengePlayer', u.socketId);
      };
    }
    playersList.appendChild(div);
  });
});

// Challenge received
socket.on('challengeReceived', ({ challengerSocketId, challengerUsername }) => {
  const accept = confirm(`You have been challenged by ${challengerUsername}. Accept?`);
  if (accept) {
    socket.emit('acceptChallenge', challengerSocketId);
  } else {
    socket.emit('declineChallenge', challengerSocketId);
  }
});

// Challenge declined
socket.on('challengeDeclined', () => {
  alert('Your challenge was declined.');
});

// ---------------- GAME START / PLAY ----------------
socket.on('startGame', ({ gameId, yourTurn, symbol }) => {
  currentGameId = gameId;
  mySymbol = symbol;
  myTurn = yourTurn;

  // Reset board
  boardDiv.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.dataset.index = i;
    cell.onclick = () => handleCellClick(i);
    boardDiv.appendChild(cell);
  }

  showScreen(gameScreen);
  statusMsg.textContent = '';
  replayBtn.classList.add('hidden');
  updateTurnIndicator();
});

// Board update
socket.on('boardUpdate', ({ board, yourTurn, gameOver, winner }) => {
  myTurn = yourTurn;
  updateBoardUI(board);

  if (!gameOver) {
    updateTurnIndicator();
  } else {
    // Game Over
    if (winner) {
      statusMsg.textContent = (winner === mySymbol)
        ? 'You Win!'
        : 'Opponent Wins!';
    } else {
      statusMsg.textContent = 'It\'s a Draw!';
    }
    replayBtn.classList.remove('hidden');
    myTurn = false;
    turnIndicator.textContent = 'Game Over';
  }
});

// Opponent quit
socket.on('opponentQuit', () => {
  statusMsg.textContent = 'Opponent quit - You win by default!';
  replayBtn.classList.remove('hidden');
});

// You quit
socket.on('youQuit', () => {
  statusMsg.textContent = 'You quit the game.';
  replayBtn.classList.remove('hidden');
});

// ----- BOT PLAY (Placeholder) -----
playBotBtn.onclick = () => {
  alert('Bot mode not implemented in this demo!');
};

// ----- GAME FUNCTIONS -----
function handleCellClick(index) {
  if (!myTurn) return;
  socket.emit('makeMove', {
    gameId: currentGameId,
    index,
    symbol: mySymbol
  });
}

function updateBoardUI(board) {
  const cells = boardDiv.querySelectorAll('.cell');
  board.forEach((val, i) => {
    cells[i].textContent = val || '';
  });
}

function updateTurnIndicator() {
  turnIndicator.textContent = myTurn ? 'Your Turn' : 'Opponent\'s Turn';
}

quitGameBtn.onclick = () => {
  if (currentGameId) {
    socket.emit('quitGame', { gameId: currentGameId });
  }
  showScreen(lobbyScreen);
};

replayBtn.onclick = () => {
  // For a real replay, you might re-challenge automatically. 
  // Here, we just go back to the lobby.
  statusMsg.textContent = '';
  replayBtn.classList.add('hidden');
  showScreen(lobbyScreen);
};

// ----- STATS POPUP -----
statsBadge.onclick = async () => {
  const username = currentUsernameSpan.textContent;
  try {
    const res = await fetch(`/login?username=${username}`);
    const data = await res.json();
    if (data.success) {
      const user = data.user;
      statsPopup.innerHTML = `
        <p>Username: ${user.username}</p>
        <p>Games: ${user.games}</p>
        <p>Wins: ${user.wins}</p>
        <p>Losses: ${user.losses}</p>
      `;
      statsPopup.classList.toggle('hidden');
    }
  } catch (err) {
    console.error(err);
  }
};

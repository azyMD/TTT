const socket = io();

const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');

const usernameInput = document.getElementById('username');
const loginBtn = document.getElementById('login-btn');
const telegramLoginBtn = document.getElementById('telegram-login-btn');

const currentUserSpan = document.getElementById('current-user');
const playBotBtn = document.getElementById('play-bot-btn');
const playersList = document.getElementById('players-list');

const turnIndicator = document.getElementById('turn-indicator');
const quitGameBtn = document.getElementById('quit-game-btn');
const statusMsg = document.getElementById('status-msg');
const replayBtn = document.getElementById('replay-btn');
const boardDiv = document.getElementById('board');

let currentGameId = null;
let mySymbol = null;
let myTurn = false;

// Switch visible screen
function showScreen(screen) {
  [loginScreen, lobbyScreen, gameScreen].forEach(el => el.classList.add('hidden'));
  screen.classList.remove('hidden');
}

// Login
loginBtn.onclick = async () => {
  const username = usernameInput.value.trim();
  if (!username) return alert("Please enter a username.");
  try {
    const res = await fetch(`/login?username=${encodeURIComponent(username)}`);
    const data = await res.json();
    if (data.success) {
      currentUserSpan.textContent = data.user.username;
      showScreen(lobbyScreen);
      socket.emit('joinLobby', data.user.username);
    }
  } catch (err) {
    console.error(err);
  }
};

// Telegram login (demo)
telegramLoginBtn.onclick = async () => {
  try {
    const res = await fetch('/telegram-login');
    const data = await res.json();
    if (data.success) {
      currentUserSpan.textContent = data.user.username;
      showScreen(lobbyScreen);
      socket.emit('joinLobby', data.user.username);
    }
  } catch (err) {
    console.error(err);
  }
};

// Lobby updates
socket.on('lobbyUpdate', (userList) => {
  playersList.innerHTML = '';
  userList.forEach(u => {
    if (u.socketId === socket.id) return; // skip ourselves
    const div = document.createElement('div');
    div.textContent = `${u.username} (${u.status})`;
    div.style.cursor = (u.status === 'available') ? 'pointer' : 'not-allowed';
    if (u.status === 'available') {
      div.onclick = () => {
        socket.emit('challengePlayer', u.socketId);
      };
    }
    playersList.appendChild(div);
  });
});

// challengeReceived
socket.on('challengeReceived', ({ challengerSocketId, challengerUsername }) => {
  const accept = confirm(`You have been challenged by ${challengerUsername}. Accept?`);
  if (accept) {
    socket.emit('acceptChallenge', challengerSocketId);
  } else {
    socket.emit('declineChallenge', challengerSocketId);
  }
});

// challengeDeclined
socket.on('challengeDeclined', () => {
  alert("Your challenge was declined.");
});

// startGame
socket.on('startGame', ({ gameId, yourTurn, symbol }) => {
  currentGameId = gameId;
  mySymbol = symbol;
  myTurn = yourTurn;

  // Clear board
  boardDiv.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.classList.add('cell');
    cell.onclick = () => handleCellClick(i);
    boardDiv.appendChild(cell);
  }

  showScreen(gameScreen);
  statusMsg.textContent = '';
  replayBtn.classList.add('hidden');
  updateTurnIndicator();
});

// boardUpdate
socket.on('boardUpdate', ({ board, yourTurn, gameOver, winner }) => {
  myTurn = yourTurn;
  updateBoardUI(board);
  if (!gameOver) {
    updateTurnIndicator();
  } else {
    if (winner) {
      statusMsg.textContent = (winner === mySymbol) ? "You Win!" : "Opponent Wins!";
    } else {
      statusMsg.textContent = "It's a Draw!";
    }
    replayBtn.classList.remove('hidden');
    myTurn = false;
    turnIndicator.textContent = "Game Over";
  }
});

// Opponent quit
socket.on('opponentQuit', () => {
  statusMsg.textContent = "Opponent quit - you win by default!";
  replayBtn.classList.remove('hidden');
});

// You quit
socket.on('youQuit', () => {
  statusMsg.textContent = "You quit the game.";
  replayBtn.classList.remove('hidden');
});

// Handle cell click
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
  turnIndicator.textContent = myTurn ? "Your Turn" : "Opponent's Turn";
}

quitGameBtn.onclick = () => {
  if (currentGameId) {
    socket.emit('quitGame', { gameId: currentGameId });
  }
  showScreen(lobbyScreen);
};

replayBtn.onclick = () => {
  // Just go back to the lobby in this demo. 
  statusMsg.textContent = '';
  replayBtn.classList.add('hidden');
  showScreen(lobbyScreen);
};

// Bot placeholder
playBotBtn.onclick = () => {
  alert("Bot mode not implemented in this demo.");
};

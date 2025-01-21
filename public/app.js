// public/app.js
(() => {
  const socket = io();

  // HTML elements
  const loginContainer = document.getElementById("loginContainer");
  const usernameInput = document.getElementById("usernameInput");
  const joinBtn = document.getElementById("joinBtn");

  const lobbyContainer = document.getElementById("lobbyContainer");
  const usersList = document.getElementById("usersList");
  const playBotBtn = document.getElementById("playBotBtn");

  const gameContainer = document.getElementById("gameContainer");
  const gameInfo = document.getElementById("gameInfo");
  const cells = document.querySelectorAll(".cell");
  const replayBtn = document.getElementById("replayBtn");

  let currentGameId = null;
  let currentGameState = null;

  // ---------------------
  // 1) Join the Lobby
  // ---------------------
  joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    if (!username) {
      alert("Please enter a username");
      return;
    }
    socket.emit("joinLobby", username);
    loginContainer.style.display = "none";
    lobbyContainer.style.display = "block";
  });

  // If user wants to play vs Bot
  playBotBtn.addEventListener("click", () => {
    socket.emit("playWithBot");
  });

  // ---------------------
  // 2) Listen for Lobby updates
  // ---------------------
  socket.on("lobbyData", (users) => {
    // Clear list
    usersList.innerHTML = "";
    users.forEach((user) => {
      // Skip ourselves? (Optional)
      // Actually, let's show everyone for demonstration
      const li = document.createElement("li");
      li.textContent = user.username + (user.inGame ? " (in-game)" : "");

      if (!user.inGame && user.socketId !== socket.id) {
        // Add a "Challenge" button if user is not in-game
        const challengeBtn = document.createElement("button");
        challengeBtn.textContent = "Challenge";
        challengeBtn.style.marginLeft = "10px";
        challengeBtn.addEventListener("click", () => {
          socket.emit("challengeUser", user.socketId);
        });
        li.appendChild(challengeBtn);
      }

      usersList.appendChild(li);
    });
  });

  // ---------------------
  // 3) Challenge flow
  // ---------------------
  // Received a challenge from someone
  socket.on("challengeRequest", (data) => {
    const { from, fromUsername } = data;
    const accept = confirm(`You have a challenge from ${fromUsername}. Accept?`);
    socket.emit("challengeResponse", { from, accepted: accept });
  });

  // If the challenge was declined by the opponent
  socket.on("challengeDeclined", (msg) => {
    alert(msg.reason);
  });

  // ---------------------
  // 4) Start game
  // ---------------------
  socket.on("startGame", (gameState) => {
    // Hide lobby, show game board
    lobbyContainer.style.display = "none";
    gameContainer.style.display = "block";

    currentGameId = gameState.gameId;
    currentGameState = gameState;

    renderGameState(gameState);
  });

  // Whenever the server sends an updated game state
  socket.on("updateGame", (gameState) => {
    currentGameState = gameState;
    renderGameState(gameState);
  });

  // ---------------------
  // 5) Handle board clicks
  // ---------------------
  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      if (!currentGameState || currentGameState.winner) return;
      // Figure out which cell index
      const cellIndex = parseInt(cell.dataset.index, 10);

      // Send a move to the server
      socket.emit("playerMove", {
        gameId: currentGameId,
        cellIndex
      });
    });
  });

  // ---------------------
  // 6) Replay
  // ---------------------
  replayBtn.addEventListener("click", () => {
    if (!currentGameId) return;
    socket.emit("requestReplay", currentGameId);
  });

  // ---------------------
  // Render function
  // ---------------------
  function renderGameState(game) {
    // Update the board
    game.board.forEach((symbol, idx) => {
      cells[idx].textContent = symbol ? symbol : "";
    });

    if (game.winner) {
      if (game.winner === "draw") {
        gameInfo.textContent = "It's a draw!";
      } else if (game.winner === "abandoned") {
        gameInfo.textContent = "Opponent left the game!";
      } else {
        gameInfo.textContent = `${game.winner} wins!`;
      }
      replayBtn.style.display = "inline-block";
    } else {
      // Show whose turn it is
      gameInfo.textContent = `Current turn: ${game.turn}`;
      replayBtn.style.display = "none";
    }
  }
})();

(() => {
  const socket = io();

  // HTML Elements
  const loginContainer = document.getElementById("loginContainer");
  const usernameInput = document.getElementById("usernameInput");
  const joinBtn = document.getElementById("joinBtn");

  const lobbyContainer = document.getElementById("lobbyContainer");
  const usersList = document.getElementById("usersList");
  const playBotBtn = document.getElementById("playBotBtn");

  const gameContainer = document.getElementById("gameContainer");
  const gameInfo = document.getElementById("gameInfo");
  const replayBtn = document.getElementById("replayBtn");
  const boardElement = document.getElementById("board");

  let currentGameId = null;
  let currentGameState = null;

  // Utility to log errors to the console and server
  function logError(error) {
    console.error("Frontend Error:", error);
    socket.emit("frontendError", { message: error.message, stack: error.stack });
  }

  // ---------------------
  // Join the Lobby
  // ---------------------
  joinBtn.addEventListener("click", () => {
    try {
      const username = usernameInput.value.trim();
      if (!username) {
        alert("Please enter your name!");
        return;
      }
      socket.emit("joinLobby", username);
      loginContainer.style.display = "none";
      lobbyContainer.style.display = "block";
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Play with Bot
  // ---------------------
  playBotBtn.addEventListener("click", () => {
    try {
      socket.emit("playWithBot");
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Render the Lobby
  // ---------------------
  socket.on("lobbyData", (users) => {
    try {
      usersList.innerHTML = "";
      users.forEach((user) => {
        const li = document.createElement("li");
        li.textContent = `${user.username} ${user.inGame ? "(in-game)" : ""}`;
        if (!user.inGame && user.socketId !== socket.id) {
          const challengeBtn = document.createElement("button");
          challengeBtn.textContent = "Challenge";
          challengeBtn.addEventListener("click", () => {
            socket.emit("challengeUser", user.socketId);
          });
          li.appendChild(challengeBtn);
        }
        usersList.appendChild(li);
      });
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Handle Challenge Requests
  // ---------------------
  socket.on("challengeRequest", ({ from, fromUsername }) => {
    try {
      const accept = confirm(`${fromUsername} challenged you! Accept?`);
      socket.emit("challengeResponse", { from, accepted: accept });
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Start the Game
  // ---------------------
  socket.on("startGame", (gameState) => {
    try {
      currentGameId = gameState.gameId;
      currentGameState = gameState;
      lobbyContainer.style.display = "none";
      gameContainer.style.display = "block";
      renderGameState(gameState);
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Update Game State
  // ---------------------
  socket.on("updateGame", (gameState) => {
    try {
      currentGameState = gameState;
      renderGameState(gameState);
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Render the Game Board
  // ---------------------
  function renderGameState(game) {
    try {
      boardElement.innerHTML = "";
      game.board.forEach((symbol, index) => {
        const cell = document.createElement("div");
        cell.classList.add("cell");
        cell.dataset.index = index;
        cell.textContent = symbol || "";
        if (symbol) cell.classList.add("taken");
        if (!symbol && !game.winner) {
          cell.addEventListener("click", () => makeMove(index));
        }
        boardElement.appendChild(cell);
      });

      if (game.winner) {
        gameInfo.textContent =
          game.winner === "draw" ? "It's a draw!" : `${game.winner} wins!`;
        replayBtn.style.display = "block";
      } else {
        gameInfo.textContent = `Turn: ${game.currentPlayer}`;
        replayBtn.style.display = "none";
      }
    } catch (err) {
      logError(err);
    }
  }

  // ---------------------
  // Make a Move
  // ---------------------
  function makeMove(cellIndex) {
    try {
      socket.emit("playerMove", { gameId: currentGameId, cellIndex });
    } catch (err) {
      logError(err);
    }
  }

  // ---------------------
  // Replay the Game
  // ---------------------
  replayBtn.addEventListener("click", () => {
    try {
      socket.emit("requestReplay", { gameId: currentGameId });
    } catch (err) {
      logError(err);
    }
  });

  // ---------------------
  // Error Handling from Server
  // ---------------------
  socket.on("errorOccurred", (message) => {
    alert(message);
  });

  // Global Error Listeners
  window.addEventListener("error", (e) => logError(e.error));
  window.addEventListener("unhandledrejection", (e) => logError(e.reason));
})();

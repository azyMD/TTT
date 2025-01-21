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
  let currentPlayerSymbol = null; // 'X' or 'O'

  // Utility to log errors
  function logError(error) {
    console.error("Frontend Error:", error);
    socket.emit("frontendError", { message: error.message, stack: error.stack });
  }

  // ---------------------
  // Join the Lobby
  // ---------------------
  joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    if (!username) {
      alert("Please enter your name!");
      return;
    }
    socket.emit("joinLobby", username);

    loginContainer.style.display = "none";
    lobbyContainer.style.display = "block";
  });

  // (Optional) Play with Bot
  playBotBtn.addEventListener("click", () => {
    socket.emit("playWithBot");
  });

  // ---------------------
  // Render Lobby
  // ---------------------
  socket.on("lobbyData", (users) => {
    usersList.innerHTML = "";
    users.forEach((user) => {
      const li = document.createElement("li");
      li.textContent = `${user.username} ${user.inGame ? "(in-game)" : ""}`;

      // Show challenge button if user is not in game and is not yourself
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
  });

  // ---------------------
  // Handle Challenge Request
  // ---------------------
  socket.on("challengeRequest", ({ from, fromUsername }) => {
    const accept = confirm(`${fromUsername} challenged you! Accept?`);
    socket.emit("challengeResponse", { from, accepted: accept });
  });

  socket.on("challengeDeclined", ({ reason }) => {
    alert(reason);
  });

  // ---------------------
  // Start Game
  // ---------------------
  socket.on("startGame", (gameState) => {
    console.log("Game started:", gameState);
    currentGameId = gameState.gameId;
    currentGameState = gameState;

    // Figure out which symbol this client is
    const player = gameState.players.find((p) => p.socketId === socket.id);
    currentPlayerSymbol = player ? player.symbol : null;

    lobbyContainer.style.display = "none";
    gameContainer.style.display = "block";

    renderGameState(gameState);
  });

  // ---------------------
  // Update Game
  // ---------------------
  socket.on("updateGame", (gameState) => {
    console.log("Updated game state received:", gameState);
    currentGameState = gameState;
    renderGameState(gameState);
  });

  // ---------------------
  // Render Game State
  // ---------------------
  function renderGameState(game) {
    // Update info text
    if (game.winner) {
      if (game.winner === "draw") {
        gameInfo.textContent = "It's a draw!";
      } else if (game.winner === "abandoned") {
        gameInfo.textContent = "Your opponent left the game.";
      } else {
        gameInfo.textContent = `${game.winner} wins!`;
      }
      replayBtn.style.display = "block";
    } else {
      gameInfo.textContent = `Turn: ${game.currentPlayer}`;
      replayBtn.style.display = "none";
    }

    // Clear current board
    boardElement.innerHTML = "";

    // Render cells
    game.board.forEach((symbol, index) => {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.index = index;
      cell.textContent = symbol || "";

      if (symbol) {
        cell.classList.add("taken");
      } else if (!game.winner && game.currentPlayer === currentPlayerSymbol) {
        // If it's my turn and cell is empty, add a click handler
        cell.addEventListener("click", onCellClick);
      }
      boardElement.appendChild(cell);
    });
  }

  // We define the click listener as a named function so we can remove it if needed
  function onCellClick(e) {
    const cell = e.target;
    const index = parseInt(cell.dataset.index, 10);

    // Immediately update UI (optimistic) and remove the click listener
    cell.textContent = currentPlayerSymbol;
    cell.classList.add("taken");
    cell.removeEventListener("click", onCellClick);

    // Send the move to the server
    socket.emit("playerMove", { gameId: currentGameId, cellIndex: index });
  }

  // ---------------------
  // (Optional) Replay the Game
  // ---------------------
  // This is only relevant if you implement replay logic on the server
  replayBtn.addEventListener("click", () => {
    // e.g. You might have:
    // socket.emit("requestReplay", { gameId: currentGameId });
    alert("Replay logic not implemented on the server side yet.");
  });

  // ---------------------
  // Error Handling
  // ---------------------
  socket.on("errorOccurred", (message) => {
    alert(message);
  });

  // Log global errors
  window.addEventListener("error", (e) => logError(e.error));
  window.addEventListener("unhandledrejection", (e) => logError(e.reason));
})();

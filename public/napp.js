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
  let currentPlayerSymbol = null; // Track the player's symbol ('X' or 'O')

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

  // Play with Bot
  playBotBtn.addEventListener("click", () => {
    socket.emit("playWithBot");
  });

  // Render Lobby
  socket.on("lobbyData", (users) => {
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
  });

  // Handle Challenge Requests
  socket.on("challengeRequest", ({ from, fromUsername }) => {
    const accept = confirm(`${fromUsername} challenged you! Accept?`);
    socket.emit("challengeResponse", { from, accepted: accept });
  });

  // Start Game
  socket.on("startGame", (gameState) => {
    console.log("Game started:", gameState); // Debugging
    currentGameId = gameState.gameId;
    currentGameState = gameState;

    // Determine the player's symbol ('X' or 'O')
    const player = gameState.players.find((p) => p.socketId === socket.id);
    currentPlayerSymbol = player ? player.symbol : null;

    console.log("Your symbol:", currentPlayerSymbol); // Debugging

    lobbyContainer.style.display = "none";
    gameContainer.style.display = "block";
    renderGameState(gameState);
  });

  // Update Game
  socket.on("updateGame", (gameState) => {
    console.log("Updated game state received from server:", gameState); // Debugging
    currentGameState = gameState;
    renderGameState(gameState);
  });

  // Render Game State
  function renderGameState(game) {
    console.log("Rendering game state:", game); // Debugging

    // Update game info
    if (game.winner) {
      gameInfo.textContent =
        game.winner === "draw" ? "It's a draw!" : `${game.winner} wins!`;
      replayBtn.style.display = "block";
    } else {
      gameInfo.textContent = `Turn: ${game.currentPlayer}`;
      replayBtn.style.display = "none";
    }

    // Render the board
    boardElement.innerHTML = ""; // Clear the board
    game.board.forEach((symbol, index) => {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.index = index;

      // Set cell content and state
      cell.textContent = symbol || ""; // Show 'X', 'O', or leave blank
      if (symbol) {
        cell.classList.add("taken"); // Mark taken cells
      } else if (!game.winner && game.currentPlayer === currentPlayerSymbol) {
        // Add click event listener for empty cells only if it's this player's turn
        cell.addEventListener("click", () => handleCellClick(index, cell));
      }

      boardElement.appendChild(cell);
    });
  }

  // Handle Cell Click
  function handleCellClick(cellIndex, cell) {
    console.log("Player clicked cell:", cellIndex); // Debugging

    // Optimistically update the board immediately
    cell.textContent = currentPlayerSymbol;
    cell.classList.add("taken");
    cell.removeEventListener("click", () => handleCellClick(cellIndex, cell)); // Prevent double-clicks

    // Send the move to the server
    makeMove(cellIndex);
  }

  // Make a Move
  function makeMove(cellIndex) {
    console.log("Making move at cell:", cellIndex); // Debugging
    socket.emit("playerMove", { gameId: currentGameId, cellIndex });
  }

  // Replay the Game
  replayBtn.addEventListener("click", () => {
    socket.emit("requestReplay", { gameId: currentGameId });
  });

  // Error Handling
  socket.on("errorOccurred", (message) => {
    alert(message);
  });

  // Global Error Listener
  window.addEventListener("error", (e) => logError(e.error));
  window.addEventListener("unhandledrejection", (e) => logError(e.reason));
})();

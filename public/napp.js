(() => {
  const socket = io();

  const loginContainer = document.getElementById("loginContainer");
  const usernameInput = document.getElementById("usernameInput");
  const joinBtn = document.getElementById("joinBtn");

  const lobbyContainer = document.getElementById("lobbyContainer");
  const usersList = document.getElementById("usersList");
  const playBotBtn = document.getElementById("playBotBtn");

  const gameContainer = document.getElementById("gameContainer");
  const gameInfo = document.getElementById("gameInfo");
  const replayBtn = document.getElementById("replayBtn");
  const exitLobbyBtn = document.getElementById("exitLobbyBtn");
  const boardElement = document.getElementById("board");

  let currentGameId = null;
  let currentGameState = null;
  let currentPlayerSymbol = null;

  // Join Lobby
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

  // Lobby Data
  socket.on("lobbyData", (users) => {
    usersList.innerHTML = "";
    users.forEach((user) => {
      const li = document.createElement("li");
      li.textContent = `${user.username} (W: ${user.score.wins}, L: ${user.score.losses}, D: ${user.score.draws})`;
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

  // Challenge requests
  socket.on("challengeRequest", ({ from, fromUsername }) => {
    const accept = confirm(`${fromUsername} challenged you! Accept?`);
    socket.emit("challengeResponse", { from, accepted: accept });
  });

  socket.on("challengeDeclined", ({ reason }) => {
    alert(reason);
  });

  // Start Game
  socket.on("startGame", (gameState) => {
    currentGameId = gameState.gameId;
    currentGameState = gameState;
    const player = gameState.players.find(p => p.socketId === socket.id);
    currentPlayerSymbol = player.symbol;

    lobbyContainer.style.display = "none";
    gameContainer.style.display = "block";

    renderGameState(gameState);
  });

  // Update Game
  socket.on("updateGame", (gameState) => {
    currentGameState = gameState;
    renderGameState(gameState);
  });

  // Replay
  replayBtn.addEventListener("click", () => {
    socket.emit("requestReplay", { gameId: currentGameId });
  });

  // Exit Lobby
  exitLobbyBtn.addEventListener("click", () => {
    socket.emit("exitToLobby", { gameId: currentGameId });
  });

  // Returned to Lobby
  socket.on("returnedToLobby", () => {
    gameContainer.style.display = "none";
    lobbyContainer.style.display = "block";
    currentGameId = null;
    currentGameState = null;
    currentPlayerSymbol = null;
  });

  function renderGameState(game) {
    if (game.winner) {
      if (game.winner === "draw") {
        gameInfo.textContent = "It's a draw!";
      } else if (game.winner === "abandoned") {
        gameInfo.textContent = "Opponent left the game.";
      } else {
        gameInfo.textContent = `${game.winner} wins!`;
      }
      replayBtn.style.display = "block";
      exitLobbyBtn.style.display = "block";
    } else {
      gameInfo.textContent = `Turn: ${game.currentPlayer}`;
      replayBtn.style.display = "none";
      exitLobbyBtn.style.display = "block";
    }

    boardElement.innerHTML = "";
    game.board.forEach((symbol, index) => {
      const cell = document.createElement("div");
      cell.classList.add("cell");
      cell.dataset.index = index;
      cell.textContent = symbol || "";

      // If there's no winner, it's my turn, and the cell is empty => clickable
      if (!game.winner && game.currentPlayer === currentPlayerSymbol && !symbol) {
        cell.addEventListener("click", () => {
          socket.emit("playerMove", { gameId: currentGameId, cellIndex: index });
        });
      }

      boardElement.appendChild(cell);
    });
  }
})();

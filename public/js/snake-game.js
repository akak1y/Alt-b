import { ref } from 'vue';

const GRID_SIZE = 18;
const TICK_MS = 110;

const DIRECTIONS = {
    ArrowUp: { x: 0, y: -1 },
    w: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    s: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    a: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    d: { x: 1, y: 0 },
};

export function createSnakeGame(canvasRef, onScore, onStop) {
    let timer = null;
    let running = false;
    let state = null;

    // Выбирает свободную ячейку для следующей цели.
    function placeFood() {
        let food;
        do {
            food = {
                x: Math.floor(Math.random() * GRID_SIZE),
                y: Math.floor(Math.random() * GRID_SIZE),
            };
        } while (state.snake.some((part) => part.x === food.x && part.y === food.y));
        state.food = food;
    }

    function draw() {
        // Перерисовывает сетку, цель и змейку только на одном игровом шаге.
        const canvas = canvasRef.value;
        if (!canvas || !state) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        const cell = canvas.width / GRID_SIZE;

        context.fillStyle = '#070a18';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = 'rgba(34,230,255,0.09)';
        context.beginPath();
        for (let i = 0; i <= GRID_SIZE; i += 1) {
            context.moveTo(i * cell, 0);
            context.lineTo(i * cell, canvas.height);
            context.moveTo(0, i * cell);
            context.lineTo(canvas.width, i * cell);
        }
        context.stroke();

        context.fillStyle = '#ff22cc';
        context.fillRect(state.food.x * cell + 3, state.food.y * cell + 3, cell - 6, cell - 6);
        state.snake.forEach((part, index) => {
            context.fillStyle = index === 0 ? '#22e6ff' : '#6c8ce7';
            context.fillRect(part.x * cell + 2, part.y * cell + 2, cell - 4, cell - 4);
        });
    }

    function stop() {
        // Снимает интервал и сообщает интерфейсу о завершении движения.
        running = false;
        if (timer) window.clearInterval(timer);
        timer = null;
        onStop();
    }

    function tick() {
        // Проверяет следующую ячейку и обновляет змейку или длину при попадании в цель.
        state.direction = state.nextDirection;
        const head = state.snake[0];
        const next = {
            x: head.x + state.direction.x,
            y: head.y + state.direction.y,
        };
        const hitWall = next.x < 0 || next.y < 0 || next.x >= GRID_SIZE || next.y >= GRID_SIZE;
        const occupied = new Set(state.snake.map((part) => `${part.x}:${part.y}`));
        if (hitWall || occupied.has(`${next.x}:${next.y}`)) {
            stop();
            draw();
            return;
        }

        state.snake.unshift(next);
        if (next.x === state.food.x && next.y === state.food.y) {
            onScore();
            placeFood();
        } else {
            state.snake.pop();
        }
        draw();
    }

    function start() {
        // Сбрасывает поле, счёт и запускает ровно один цикл обновления.
        // При повторном старте снимаем старый таймер без ложного уведомления
        // интерфейса об остановке новой партии.
        if (timer) window.clearInterval(timer);
        timer = null;
        state = {
            snake: [
                { x: 9, y: 9 },
                { x: 8, y: 9 },
                { x: 7, y: 9 },
            ],
            direction: { x: 1, y: 0 },
            nextDirection: { x: 1, y: 0 },
            food: { x: 13, y: 9 },
        };
        running = true;
        onScore(true);
        draw();
        timer = window.setInterval(tick, TICK_MS);
    }

    function setDirection(direction) {
        // Запрещает разворот на 180 градусов и сохраняет следующее направление.
        if (!state) return;
        const current = state.direction;
        if (direction.x === -current.x && direction.y === -current.y) return;
        state.nextDirection = direction;
    }

    function handleKey(event) {
        // Переводит клавиши стрелок и WASD в направление движения.
        const direction = DIRECTIONS[event.key] || DIRECTIONS[String(event.key).toLowerCase()];
        if (!direction) return false;
        event.preventDefault();
        setDirection(direction);
        return true;
    }

    function destroy() {
        stop();
        state = null;
    }

    return { start, stop, destroy, setDirection, handleKey, isRunning: () => running };
}

// Реальное состояние игрового таймера — единственный источник для надписи кнопки.
export function useSnakeControls(canvasRef) {
    const snakeScore = ref(0);
    const snakeRunning = ref(false);
    const snakeGame = createSnakeGame(
        canvasRef,
        (reset) => {
            if (reset) snakeScore.value = 0;
            else snakeScore.value += 1;
        },
        () => {
            snakeRunning.value = false;
        },
    );
    function startSnake() {
        snakeGame.start();
        snakeRunning.value = snakeGame.isRunning();
    }
    function stopSnake() {
        snakeGame.stop();
    }
    return { snakeGame, snakeScore, snakeRunning, startSnake, stopSnake };
}

const AVATAR_SIZE = 256;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

export function readImageFile(file) {
    // Проверяет тип и размер до чтения файла, чтобы не блокировать интерфейс объёмной загрузкой.
    if (!file) return Promise.reject(new Error('Файл не выбран.'));
    if (!file.type.startsWith('image/')) {
        return Promise.reject(new Error('Выберите файл изображения.'));
    }
    if (file.size > MAX_AVATAR_BYTES) {
        return Promise.reject(new Error('Изображение должно быть не больше 8 МБ.'));
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
        reader.readAsDataURL(file);
    }).then(
        (source) =>
            new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve({ source, image });
                image.onerror = () => reject(new Error('Не удалось открыть изображение.'));
                image.src = source;
            }),
    );
}

export function resizeAvatar(image) {
    // Кропает квадратное центральное поле и создаёт компактный JPEG для локального хранения.
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает обработку изображений.');

    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const x = (image.naturalWidth - side) / 2;
    const y = (image.naturalHeight - side) / 2;
    context.drawImage(image, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return canvas.toDataURL('image/jpeg', 0.86);
}

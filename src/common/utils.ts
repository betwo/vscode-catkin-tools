

export function wrapArray<T>(value: T | T[]): T[] {
    if (value === undefined) {
        return undefined;
    } else if (!Array.isArray(value)) {
        return [value];
    } else {
        return value;
    }
}

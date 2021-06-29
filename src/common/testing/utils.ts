
export function findFirstLine(source_code: string[], key: string): number {
    const regex = new RegExp(`(^|.*\\s)(${key})([\\s;:{].*|$)`);
    let line_number = 0;
    for (const line of source_code) {
        if (line.indexOf(key) >= 0) {
            const match = line.match(regex);
            if (match !== null) {
                return line_number;
            }
        }
        line_number += 1;
    }
    return undefined;
}
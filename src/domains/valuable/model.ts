export interface ValuableEntry {
    readonly basePrice: number;
    readonly tags?: readonly (string | { readonly key?: string; readonly label?: string })[] | undefined;
}

export interface ValuableFile extends ValuableEntry {
    readonly fileId: string;
    readonly name: string;
}

export interface ValuableLog extends ValuableEntry {
    readonly seq: number;
    readonly message: string;
}

export function isValuable(entry: ValuableEntry): boolean {
    return entry.basePrice > 0 && (entry.tags?.length ?? 0) > 0;
}

export function filterValuableFiles<T extends ValuableFile>(files: readonly T[]): T[] {
    return files.filter((file) => isValuable(file));
}

export function filterValuableLogs<T extends ValuableLog>(logs: readonly T[]): T[] {
    return logs.filter((log) => isValuable(log));
}

export function tagLabel(tag: string | { readonly key?: string; readonly label?: string }): string {
    return typeof tag === 'string' ? tag : tag.label ?? tag.key ?? '';
}

/** Serializes warehouse sorts and lets Auto Mail avoid contending with them. */
export class InventorySortLock {
    private sorting = false;

    isSorting(): boolean {
        return this.sorting;
    }

    async run<T>(operation: () => Promise<T>): Promise<T | null> {
        if (this.sorting) return null;
        this.sorting = true;
        try {
            return await operation();
        } finally {
            this.sorting = false;
        }
    }
}

/** Default real-time sleep. Application code should accept an injected sleep. */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

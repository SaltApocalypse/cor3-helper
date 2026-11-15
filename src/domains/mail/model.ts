export interface MailAttachment {
    readonly id: string;
    readonly source: string | null;
    readonly sourceId: string | null;
    readonly name: string;
    readonly itemId: string | null;
    readonly quantity: number;
    readonly width: number;
    readonly height: number;
    readonly canRotate: boolean;
}

export interface MailMessage {
    readonly id: string;
    readonly status: string;
    readonly subject: string;
    readonly attachments: readonly MailAttachment[];
}

export interface MailState {
    readonly messages: readonly MailMessage[];
    readonly pendingCount: number;
}

export function isPendingMessage(message: MailMessage): boolean {
    return message.status !== 'CLAIMED' && message.status !== 'EXPIRED';
}

export function pendingMessages(state: MailState): MailMessage[] {
    return state.messages.filter(isPendingMessage);
}

export function isStashCapacityError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('insufficient stash')
        || normalized.includes('insufficient_capacity')
        || normalized.includes('stash full')
        || normalized.includes('stash.error.insufficient')
        || normalized.includes('insufficient space')
        || normalized.includes('capacity')
        || normalized.includes('no space');
}

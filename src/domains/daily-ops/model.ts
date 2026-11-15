export interface DailyOpsState {
    readonly hasClaimedToday: boolean;
    readonly currentStreak: number;
    readonly difficulty: string;
    readonly nextTaskTime: string | null;
    readonly streakBonus: number | null;
}

export interface DailyReward {
    readonly day: number;
    readonly amount: number;
}

export function streakBonus(streak: number, rewards: readonly DailyReward[]): number | null {
    const exact = rewards.find((reward) => reward.day === streak);
    if (exact) return exact.amount;
    const eligible = rewards.filter((reward) => reward.day <= streak).sort((a, b) => b.day - a.day);
    return eligible[0] ? eligible[0].amount : null;
}

import { rawDailyOpsSchema, rawDailyRewardsSchema } from '../../contracts/daily-ops.js';
import { streakBonus, type DailyOpsState, type DailyReward } from '../../domains/daily-ops/model.js';

export function mapDailyOps(raw: unknown, rewardsRaw: unknown): DailyOpsState | null {
    const parsed = rawDailyOpsSchema.safeParse(raw);
    if (!parsed.success) return null;
    const rewardsParsed = rawDailyRewardsSchema.safeParse(rewardsRaw);
    const rewards: DailyReward[] = rewardsParsed.success
        ? (Array.isArray(rewardsParsed.data) ? rewardsParsed.data : rewardsParsed.data.rewards)
            .filter((entry) => typeof entry.day === 'number' && typeof entry.amount === 'number')
            .map((entry) => ({ day: entry.day!, amount: entry.amount! }))
        : [];
    const currentStreak = parsed.data.currentStreak ?? 0;
    return {
        hasClaimedToday: parsed.data.hasClaimedToday === true,
        currentStreak,
        difficulty: parsed.data.difficulty ?? 'unknown',
        nextTaskTime: parsed.data.nextTaskTime ?? null,
        streakBonus: streakBonus(currentStreak, rewards),
    };
}

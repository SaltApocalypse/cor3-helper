import { z } from 'zod';

export const UPDATE_CHECK_STATUSES = ['available', 'latest', 'failed'] as const;
export type UpdateCheckStatus = typeof UPDATE_CHECK_STATUSES[number];

export const UPDATE_CHECK_ERROR_CODES = [
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'TIMEOUT',
    'JSON_ERROR',
    'INVALID_RESPONSE',
    'INVALID_VERSION',
    'STORAGE_READ_FAILED',
    'STORAGE_WRITE_FAILED',
] as const;
export type UpdateCheckErrorCode = typeof UPDATE_CHECK_ERROR_CODES[number];

export const updateCheckErrorSchema = z.object({
    code: z.enum(UPDATE_CHECK_ERROR_CODES),
    message: z.string().min(1),
    httpStatus: z.number().int().min(100).max(599).optional(),
}).strict();

export type UpdateCheckError = z.infer<typeof updateCheckErrorSchema>;

export const updateCheckSuccessSchema = z.object({
    status: z.enum(['available', 'latest']),
    currentVersion: z.string().min(1),
    latestVersion: z.string().min(1),
    releaseUrl: z.string().url(),
    checkedAt: z.number().int().nonnegative(),
    source: z.string().min(1),
}).strict();

export type UpdateCheckSuccess = z.infer<typeof updateCheckSuccessSchema>;

export const updateCheckResultSchema = z.object({
    status: z.enum(UPDATE_CHECK_STATUSES),
    currentVersion: z.string().min(1),
    latestVersion: z.string().min(1).optional(),
    releaseUrl: z.string().url().optional(),
    checkedAt: z.number().int().nonnegative(),
    error: updateCheckErrorSchema.optional(),
    lastSuccess: updateCheckSuccessSchema.nullable().default(null),
}).strict();

export type UpdateCheckResult = z.infer<typeof updateCheckResultSchema>;

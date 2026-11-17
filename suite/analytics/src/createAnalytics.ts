import { type Analytics, QueuedAnalytics } from '@trezor/analytics-uploader';

import { type AnalyticsDesktopEvents } from './analyticsEvents';

export type DesktopAnalytics = Analytics<AnalyticsDesktopEvents>;

export type DesktopAnalyticsDep = {
    analytics: DesktopAnalytics;
};

export const injectDesktopAnalytics = (services: any): DesktopAnalyticsDep => ({
    analytics: services.analytics,
});

export const createAnalytics = (): DesktopAnalytics => {
    const analytics = new QueuedAnalytics<AnalyticsDesktopEvents>({
        version: process.env.VERSION!,
        app: 'suite',
        useQueue: true,
    });
    // Suite Dark: never report anything, including the events upstream sends with `force`
    // regardless of the user's analytics choice.
    analytics.report = () => {};

    return analytics;
};

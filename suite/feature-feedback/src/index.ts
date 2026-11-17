import { type FeedbackCardProps } from './components/FeedbackCard/FeedbackCard';

export {
    featureFeedbackReducer,
    featureUsed,
    feedbackRequested,
    feedbackDismissed,
    featureFeedbackActions,
} from './featureFeedbackSlice';

export { initialState } from './featureFeedbackSlice';

export type { FeedbackCardProps };

// Suite Dark: feedback forms are removed. Consumers keep their imports, including feedback cards
// upstream adds later, but nothing renders and the sidebar never asks for a rating.
export const FeedbackCard = (_props: FeedbackCardProps) => null;
export const FeedbackFormManager = () => null;
export const selectShouldShowFeedbackSidebarBanner = (_state: unknown): boolean => false;

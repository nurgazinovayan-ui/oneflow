import { createContext, useContext } from 'react';

export interface SubscriptionState {
  active: boolean;
  requestPayment: () => void;
}

// Default is "unblocked" — a node rendered outside the provider (shouldn't happen in practice)
// fails open rather than silently disabling every Generate button.
export const SubscriptionContext = createContext<SubscriptionState>({
  active: true,
  requestPayment: () => {},
});

export const useSubscription = () => useContext(SubscriptionContext);

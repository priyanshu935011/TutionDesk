-- Fix check constraint on cashfree_payments table to allow new payment types:
-- 'wallet_recharge', 'ai_wallet_recharge', 'subscription'

-- 1. Drop existing restrictive check constraint
ALTER TABLE public.cashfree_payments 
DROP CONSTRAINT IF EXISTS cashfree_payments_type_check;

-- 2. Add updated check constraint with all supported payment types
ALTER TABLE public.cashfree_payments 
ADD CONSTRAINT cashfree_payments_type_check 
CHECK (type IN ('one_time', 'recurring', 'wallet_recharge', 'ai_wallet_recharge', 'subscription'));

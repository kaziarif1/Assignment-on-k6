-- Apply once to the local dMoney database before the performance run.
-- These indexes prevent balance and transaction-limit lookups from scanning
-- the entire ledger table. If either index already exists, skip that CREATE.

CREATE INDEX idx_transactions_account
    ON Transactions (account);

CREATE INDEX idx_transactions_limit_lookup
    ON Transactions (account, transaction_type, createdAt, debit, trnxId);

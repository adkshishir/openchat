# frozen_string_literal: true

# Removes the OpenClaw side of an OpenChat channel once its Chatwoot inbox is gone.
# Runs after DeleteObjectJob so the deletion-sync only fires once the inbox is truly deleted.
class Openchat::SyncChannelTeardownJob < ApplicationJob
  queue_as :default

  MAX_ATTEMPTS = 20

  def perform(account_id:, inbox_id:, attempt: 0)
    if Inbox.exists?(id: inbox_id, account_id: account_id) && attempt < MAX_ATTEMPTS
      # Race with DeleteObjectJob: wait until the inbox is actually gone.
      self.class.set(wait: 2.seconds).perform_later(account_id: account_id, inbox_id: inbox_id, attempt: attempt + 1)
      return
    end

    Openchat::BridgeClient.new.teardown_channel(account_id: account_id, inbox_id: inbox_id)
  end
end
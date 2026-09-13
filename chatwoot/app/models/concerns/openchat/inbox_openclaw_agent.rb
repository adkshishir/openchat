# frozen_string_literal: true

# Auto-attach OpenClaw as the agent bot whenever an inbox is created.
module Openchat::InboxOpenclawAgent
  extend ActiveSupport::Concern

  included do
    after_create_commit :attach_openclaw_agent_async
  end

  private

  def attach_openclaw_agent_async
    Openchat::AttachOpenclawAgentService.new(account: account).perform(self)
  rescue StandardError => e
    Rails.logger.warn("[OpenClaw] failed to attach agent to inbox #{id}: #{e.message}")
  end
end

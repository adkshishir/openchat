# frozen_string_literal: true

# Attach the account's OpenClaw AgentBot to one or all inboxes.
# OpenClaw is the only reply agent for OpenChat — every channel uses it.
class Openchat::AttachOpenclawAgentService
  def initialize(account:)
    @account = account
  end

  def perform_all
    bot = openclaw_bot
    return unless bot

    @account.inboxes.find_each { |inbox| attach!(inbox, bot) }
    bot
  end

  def perform(inbox)
    bot = openclaw_bot
    return unless bot && inbox

    attach!(inbox, bot)
    bot
  end

  def self.openclaw_bot_for(account)
    account.agent_bots.find_by(name: Openchat::ProvisionService::BOT_NAME) ||
      account.agent_bots.where(name: Openchat::ProvisionService::LEGACY_BOT_NAMES).first
  end

  private

  def openclaw_bot
    self.class.openclaw_bot_for(@account)
  end

  def attach!(inbox, bot)
    record = inbox.agent_bot_inbox || AgentBotInbox.new(inbox: inbox, account_id: @account.id)
    record.agent_bot = bot
    record.status = :active if record.respond_to?(:status=)
    record.save!
    # Chatwoot defaults new inboxes to auto-assignment, which hands every conversation
    # to a human the moment it opens. The reply pipeline then skips the bot for good
    # (handoff sees an assignee), so a bot-owned inbox must never auto-assign.
    inbox.update!(enable_auto_assignment: false) if inbox.enable_auto_assignment?
  end
end

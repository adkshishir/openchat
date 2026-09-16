# frozen_string_literal: true

# Creates (or reuses) the Chatwoot Channel::Api inbox for one OpenClaw token-based
# channel (Telegram, Discord, Slack, ...) and wires it to the OpenClaw agent bot.
# Shared by the account-scoped Openchat::Controller (browser flow, Current.user
# available) and the internal Openchat::Tools controller (admin-copilot tool call,
# no Chatwoot session/user) so the two flows can never drift.
class Openchat::ChannelInboxProvisioner
  def initialize(account:, inbox_name:, user: nil)
    @account = account
    @inbox_name = inbox_name
    @user = user
  end

  def perform
    existing = @account.inboxes.find_by(name: @inbox_name, channel_type: 'Channel::Api')
    if existing
      sync_secret!(existing.channel)
      return existing
    end

    webhook_url = "#{ENV.fetch('OPENCHAT_BRIDGE_URL', 'http://localhost:8090')}/webhooks/chatwoot/#{@account.id}"
    channel = @account.api_channels.create!(webhook_url: webhook_url)
    inbox = @account.inboxes.create!(name: @inbox_name, channel: channel)
    InboxMember.find_or_create_by!(inbox: inbox, user: @user) if @user
    Openchat::AttachOpenclawAgentService.new(account: @account).perform(inbox)
    sync_secret!(channel)
    inbox
  end

  private

  def sync_secret!(channel)
    bot = Openchat::AttachOpenclawAgentService.openclaw_bot_for(@account)
    return unless bot&.secret.present? && channel.respond_to?(:secret=)
    return if channel.secret == bot.secret

    channel.update!(secret: bot.secret)
  end
end

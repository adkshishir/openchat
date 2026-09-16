# frozen_string_literal: true

class Openchat::ProvisionService
  BOT_NAME = 'OpenClaw'.freeze
  LEGACY_BOT_NAMES = ['OpenChat AI'].freeze

  def initialize(account:, user: nil)
    @account = account
    @user = user
  end

  def perform
    bot = find_or_create_openclaw_bot
    ensure_account_webhook!(bot)
    Openchat::AttachOpenclawAgentService.new(account: @account).perform_all
    result = Openchat::BridgeClient.new.provision(account: @account, agent_bot: bot, admin_user_id: @user&.id)
    store_bridge_tenant_id!(result['tenant_id'])
    bot
  end

  private

  # The bridge's tenant UUID — not Chatwoot's own sequential account id — is what
  # gets handed to the browser for the one bridge surface it talks to directly
  # (the WhatsApp QR WebSocket), so a tenant can't just increment an id to probe
  # another tenant's setup stream.
  def store_bridge_tenant_id!(tenant_id)
    return if tenant_id.blank?
    return if @account.custom_attributes['openchat_tenant_id'] == tenant_id

    @account.update!(custom_attributes: (@account.custom_attributes || {}).merge('openchat_tenant_id' => tenant_id))
  end

  def bridge_webhook_url
    "#{ENV.fetch('OPENCHAT_BRIDGE_URL', 'http://localhost:8090')}/webhooks/chatwoot/#{@account.id}"
  end

  def find_or_create_openclaw_bot
    bot = @account.agent_bots.find_by(name: BOT_NAME)
    bot ||= @account.agent_bots.where(name: LEGACY_BOT_NAMES).first
    description = 'OpenClaw agent for all OpenChat channels'
    if bot
      bot.update!(
        name: BOT_NAME,
        description: description,
        outgoing_url: bridge_webhook_url,
        bot_type: :webhook
      )
      return bot
    end

    @account.agent_bots.create!(
      name: BOT_NAME,
      description: description,
      outgoing_url: bridge_webhook_url,
      bot_type: :webhook
    )
  end

  # Account webhook so every inbox notifies OpenClaw even before AgentBotInbox attaches.
  def ensure_account_webhook!(bot)
    url = bridge_webhook_url
    webhook = @account.webhooks.find_or_initialize_by(url: url)
    webhook.name = 'OpenClaw'
    webhook.webhook_type = :account_type
    webhook.subscriptions = %w[message_created message_updated conversation_updated]
    webhook.secret = bot.secret if bot.secret.present?
    webhook.save!
    webhook
  end
end

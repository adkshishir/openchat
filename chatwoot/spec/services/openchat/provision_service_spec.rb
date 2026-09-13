# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Openchat::ProvisionService do
  let(:account) { create(:account) }
  let(:user) { create(:user, account: account) }

  before do
    allow(Openchat::BridgeClient).to receive(:new).and_return(
      instance_double(Openchat::BridgeClient, provision: { 'tenant_id' => 't1' })
    )
  end

  it 'creates an OpenClaw agent and provisions the tenant' do
    bot = described_class.new(account: account, user: user).perform
    expect(bot.name).to eq('OpenClaw')
    expect(bot.description).to include('OpenClaw')
    expect(bot.outgoing_url).to include("/webhooks/chatwoot/#{account.id}")
    expect(account.webhooks.find_by(url: bot.outgoing_url)).to be_present
    expect(Openchat::BridgeClient).to have_received(:new)
  end

  it 'renames a legacy OpenChat AI bot to OpenClaw' do
    legacy = account.agent_bots.create!(
      name: 'OpenChat AI',
      description: 'legacy',
      outgoing_url: 'http://localhost:8090/old',
      bot_type: :webhook
    )
    bot = described_class.new(account: account, user: user).perform
    expect(bot.id).to eq(legacy.id)
    expect(bot.name).to eq('OpenClaw')
  end

  it 'attaches OpenClaw to every existing inbox' do
    channel = create(:channel_api, account: account)
    inbox = create(:inbox, account: account, channel: channel)
    bot = described_class.new(account: account, user: user).perform
    expect(inbox.reload.agent_bot).to eq(bot)
  end
end

RSpec.describe Openchat::AttachOpenclawAgentService do
  let(:account) { create(:account) }

  it 'no-ops when OpenClaw is not provisioned yet' do
    channel = create(:channel_api, account: account)
    inbox = create(:inbox, account: account, channel: channel)
    expect(described_class.new(account: account).perform(inbox)).to be_nil
  end

  it 'attaches OpenClaw to an inbox' do
    bot = account.agent_bots.create!(
      name: 'OpenClaw',
      description: 'agent',
      outgoing_url: 'http://localhost:8090/webhooks/chatwoot/1',
      bot_type: :webhook
    )
    channel = create(:channel_web_widget, account: account)
    inbox = create(:inbox, account: account, channel: channel)
    described_class.new(account: account).perform(inbox)
    expect(inbox.reload.agent_bot).to eq(bot)
  end
end

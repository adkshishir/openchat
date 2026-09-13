class Openchat::ProvisionTenantJob < ApplicationJob
  queue_as :default

  def perform(account, user = nil)
    Openchat::ProvisionService.new(account: account, user: user).perform
  end
end

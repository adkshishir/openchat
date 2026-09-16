<script>
import { useAlert } from 'dashboard/composables';
import SettingsLayout from '../SettingsLayout.vue';
import BaseSettingsHeader from '../components/BaseSettingsHeader.vue';
import OpenchatAPI from 'dashboard/api/openchat';

const STATUS_OPTIONS = ['new', 'fulfilled', 'cancelled'];

export default {
  components: { SettingsLayout, BaseSettingsHeader },
  data() {
    return {
      orders: [],
      isLoading: false,
      updatingId: null,
      statusOptions: STATUS_OPTIONS,
    };
  },
  mounted() {
    this.fetchOrders();
  },
  methods: {
    async fetchOrders() {
      this.isLoading = true;
      try {
        const { data } = await OpenchatAPI.getOrders();
        this.orders = data.orders || [];
      } catch (error) {
        useAlert(error?.response?.data?.error || 'Could not load orders.');
      } finally {
        this.isLoading = false;
      }
    },
    async onStatusChange(order, status) {
      this.updatingId = order.id;
      try {
        await OpenchatAPI.updateOrderStatus(order.id, status);
        order.status = status;
      } catch (error) {
        useAlert(error?.response?.data?.error || 'Could not update this order.');
      } finally {
        this.updatingId = null;
      }
    },
    formatDate(value) {
      return new Date(value).toLocaleString();
    },
  },
};
</script>

<template>
  <SettingsLayout :is-loading="isLoading">
    <template #header>
      <BaseSettingsHeader
        title="Orders"
        description="Orders the AI agent placed on its own after a customer picked a product and confirmed their details. Update the status here once an order is shipped or cancelled."
      />
    </template>
    <template #body>
      <div class="flex-grow flex-shrink overflow-auto max-w-4xl flex flex-col gap-4">
        <p v-if="!isLoading && !orders.length" class="text-sm text-n-slate-11">
          No orders yet.
        </p>
        <div
          v-for="order in orders"
          :key="order.id"
          class="border border-n-weak rounded-2xl p-4 flex flex-col gap-2"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-n-slate-12">
              {{ order.product_name }}
              <span v-if="order.variant" class="text-n-slate-11">({{ order.variant }})</span>
              <span v-if="order.product_price" class="text-n-slate-11">— {{ order.product_price }}</span>
            </span>
            <select
              :value="order.status"
              :disabled="updatingId === order.id"
              class="border border-n-weak rounded-lg px-2 py-1 text-xs bg-n-solid-1"
              @change="onStatusChange(order, $event.target.value)"
            >
              <option v-for="status in statusOptions" :key="status" :value="status">
                {{ status }}
              </option>
            </select>
          </div>
          <div class="text-sm text-n-slate-11">
            {{ order.customer_name }} · {{ order.customer_phone }}
          </div>
          <div class="text-sm text-n-slate-11">{{ order.customer_address }}</div>
          <div class="text-xs text-n-slate-11">
            Conversation #{{ order.conversation_id }} · {{ formatDate(order.created_at) }}
          </div>
        </div>
      </div>
    </template>
  </SettingsLayout>
</template>

Component({
  properties: { title: String, records: Array, subtitle: String },
  methods: {
    close() {
      this.triggerEvent('close');
    },
    open(event) {
      this.triggerEvent('open', { id: event.currentTarget.dataset.id });
    },
    imageError(event) {
      const index = event.currentTarget.dataset.index;
      this.setData({ [`records[${index}].thumbnailUrl`]: '' });
    },
  },
});

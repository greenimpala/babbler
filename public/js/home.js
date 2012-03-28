$(function() {
	var counters = $('.counter');

	var CounterModule = {
		elem: $('.counter'),

		increment: function () {
			var _values = ""
			  , self    = this;

			// Get value
			$(this.elem).each(function () {
				_values += $.trim($(this).html());
			}).promise().done( function () {
				var number = parseInt(_values, 10) + 1;
				_values = number.toString();

				// Update values
				var count = 0;

				$(self.elem).each(function () {
					$(this).html(_values.charAt(count));
					count += 1;
				});
			});
		},

		init: function () {
			var self = this;
			setInterval(function(){
				self.increment();
			}, 1000);

			return this;
		}
	};
});
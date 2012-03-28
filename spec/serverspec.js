describe('Calculator', function () {
  var counter = 0

  it('can add a number', function () {
    counter = counter + 2;   // counter was 0 before
    expect(counter).toEqual(2);
  });

  it('can multiply a number', function () {
    counter = counter * 5;   // counter was 2 before
    expect(counter).toEqual(10);
  });
});
describe('Basic Test Suite', () => {
  it('should run basic tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test async operations', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });

  it('should test error handling', () => {
    expect(() => {
      throw new Error('Test error');
    }).toThrow('Test error');
  });
});
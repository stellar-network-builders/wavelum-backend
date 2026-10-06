describe('vaultBalanceMonitoringJob', () => {
  let cron;
  let serviceInstance;
  let job;
  let scheduledTask;
  let logSpy;
  let warnSpy;
  let errorSpy;

  const loadJob = () => {
    jest.resetModules();

    scheduledTask = {
      stop: jest.fn(),
    };

    serviceInstance = {
      isEnabled: jest.fn().mockReturnValue(true),
      runCheck: jest.fn().mockResolvedValue({
        checked: 1,
        discrepancies: 0,
        alertsSent: 0,
        errors: 0,
      }),
    };

    jest.doMock('node-cron', () => ({
      schedule: jest.fn(() => scheduledTask),
    }));

    jest.doMock('../services/vaultBalanceMonitorService', () =>
      jest.fn(() => serviceInstance)
    );

    job = require('./vaultBalanceMonitoringJob');
    cron = require('node-cron');
  };

  beforeEach(() => {
    delete process.env.VAULT_BALANCE_MONITOR_CRON;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    loadJob();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('schedules the cron job with the configured interval', () => {
    process.env.VAULT_BALANCE_MONITOR_CRON = '*/10 * * * *';
    loadJob();

    job.start();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledWith(
      '*/10 * * * *',
      expect.any(Function)
    );
  });

  it('does not schedule when the service is disabled', () => {
    serviceInstance.isEnabled.mockReturnValue(false);

    job.start();

    expect(cron.schedule).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Vault balance monitoring job is disabled via VAULT_BALANCE_MONITOR_ENABLED=false'
    );
  });

  it('does not schedule twice when already running', () => {
    job.start();
    job.start();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Vault balance monitoring job is already running'
    );
  });

  it('stops the scheduled task and clears the cron job reference', () => {
    job.start();

    job.stop();

    expect(scheduledTask.stop).toHaveBeenCalledTimes(1);
    expect(job.cronJob).toBeNull();
  });

  it('runs the monitor service when executed', async () => {
    await job.execute();

    expect(serviceInstance.runCheck).toHaveBeenCalledTimes(1);
    expect(job.isRunning).toBe(false);
  });

  it('skips overlapping executions', async () => {
    let releaseRun;
    serviceInstance.runCheck.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = resolve;
        })
    );

    const firstExecution = job.execute();
    const secondExecution = job.execute();

    await Promise.resolve();

    expect(serviceInstance.runCheck).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Vault balance monitoring job already in progress, skipping overlapping run.'
    );

    releaseRun();
    await firstExecution;
    await secondExecution;
    expect(job.isRunning).toBe(false);
  });

  it('logs execution failures and resets the running flag', async () => {
    const failure = new Error('RPC timeout');
    serviceInstance.runCheck.mockRejectedValue(failure);

    await job.execute();

    expect(errorSpy).toHaveBeenCalledWith(
      'Vault balance monitoring job failed:',
      failure
    );
    expect(job.isRunning).toBe(false);
  });
});

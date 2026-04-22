#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <math.h>

#define PUMP   PB14
#define VALVE1 PB0
#define VALVE2 PB1

Adafruit_ADS1115 ads;
String cmd;

unsigned long lastAdcMs = 0;
const unsigned long adcPeriodMs = 10;   // final output rate = 100 Hz

const float fs = 100.0f;
const float fc = 2.0f;
float alpha = 0.0f;
float y_lpf = 0.0f;
bool lpf_initialized = false;

void setup() {
  pinMode(PUMP, OUTPUT);
  pinMode(VALVE1, OUTPUT);
  pinMode(VALVE2, OUTPUT);

  digitalWrite(PUMP, LOW);
  digitalWrite(VALVE1, LOW);
  digitalWrite(VALVE2, LOW);

  Serial.begin(921600);
  delay(1500);

  Wire.setSCL(PB8);
  Wire.setSDA(PB9);
  Wire.begin();

  Serial.println("Starting ADS1115...");

  if (!ads.begin(0x48, &Wire)) {
    Serial.println("ADS1115 not found");
    while (1) delay(1000);
  }

  ads.setGain(GAIN_ONE);
  ads.setDataRate(RATE_ADS1115_860SPS);   // run ADC much faster

  float dt = 1.0f / fs;
  float RC = 1.0f / (2.0f * PI * fc);
  alpha = dt / (RC + dt);

  Serial.println("ADS1115 OK");
  Serial.println("Commands: p1 p0 q1 q0 r1 r0");
  Serial.print("LPF alpha = ");
  Serial.println(alpha, 6);

  Serial.println("t_ms,A0,LPF");
}

float readAveragedADS(int nAvg) {
  long acc = 0;
  for (int i = 0; i < nAvg; i++) {
    acc += ads.readADC_SingleEnded(0);
  }
  return acc / (float)nAvg;
}

void loop() {
  if (Serial.available()) {
    cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "p1") {
      digitalWrite(PUMP, HIGH);
      Serial.println("PUMP HIGH");
    } else if (cmd == "p0") {
      digitalWrite(PUMP, LOW);
      Serial.println("PUMP LOW");
    } else if (cmd == "q1") {
      digitalWrite(VALVE1, HIGH);
      Serial.println("VALVE1 HIGH");
    } else if (cmd == "q0") {
      digitalWrite(VALVE1, LOW);
      Serial.println("VALVE1 LOW");
    } else if (cmd == "r1") {
      digitalWrite(VALVE2, HIGH);
      Serial.println("VALVE2 HIGH");
    } else if (cmd == "r0") {
      digitalWrite(VALVE2, LOW);
      Serial.println("VALVE2 LOW");
    } else {
      Serial.print("Unknown command: ");
      Serial.println(cmd);
    }
  }

  unsigned long now = millis();
  if (now - lastAdcMs >= adcPeriodMs) {
    lastAdcMs = now;

    float raw = readAveragedADS(8);   // oversample + average

    if (!lpf_initialized) {
      y_lpf = raw;
      lpf_initialized = true;
    } else {
      y_lpf = y_lpf + alpha * (raw - y_lpf);
    }

    Serial.print(now);
    Serial.print(",");
    Serial.print(raw, 2);
    Serial.print(",");
    Serial.println(y_lpf, 2);
  }
}
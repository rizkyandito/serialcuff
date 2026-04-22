// valve 2 (r) control from air tank to cuff
// valve 1 (q) from cuff to atmosphere
// STM32U585 version using internal ADC on A0 (14-bit)

#include <Arduino.h>
#include <Wire.h>
#include <math.h>

#define PUMP   PB14
#define VALVE1 PB0
#define VALVE2 PB1
#define ADC_PIN A0

String cmd;

unsigned long lastAdcMs = 0;
const unsigned long adcPeriodMs = 10;   // 100 Hz

// LPF params
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

  pinMode(ADC_PIN, INPUT);
  analogReadResolution(14);   // STM32U585 internal ADC resolution

  float dt = 1.0f / fs;
  float RC = 1.0f / (2.0f * PI * fc);
  alpha = dt / (RC + dt);

  Serial.println("STM32U585 internal ADC OK");
  Serial.println("Commands: p1 p0 q1 q0 r1 r0");
  Serial.print("LPF alpha = ");
  Serial.println(alpha, 6);
}

void loop() {
  // ----------------------------
  // serial command handling
  // ----------------------------
  if (Serial.available()) {
    cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "p1") {
      digitalWrite(PUMP, HIGH);
      Serial.println("PUMP HIGH");
    }
    else if (cmd == "p0") {
      digitalWrite(PUMP, LOW);
      Serial.println("PUMP LOW");
    }
    else if (cmd == "q1") {
      digitalWrite(VALVE1, HIGH);
      Serial.println("VALVE1 HIGH");
    }
    else if (cmd == "q0") {
      digitalWrite(VALVE1, LOW);
      Serial.println("VALVE1 LOW");
    }
    else if (cmd == "r1") {
      digitalWrite(VALVE2, HIGH);
      Serial.println("VALVE2 HIGH");
    }
    else if (cmd == "r0") {
      digitalWrite(VALVE2, LOW);
      Serial.println("VALVE2 LOW");
    }
    else {
      Serial.print("Unknown command: ");
      Serial.println(cmd);
    }
  }

  // ----------------------------
  // periodic ADC read + LPF
  // ----------------------------
  unsigned long now = millis();
  if (now - lastAdcMs >= adcPeriodMs) {
    lastAdcMs = now;

    uint16_t raw = analogRead(ADC_PIN);   // 0 ... 16383 for 14-bit

    if (!lpf_initialized) {
      y_lpf = (float)raw;
      lpf_initialized = true;
    } else {
      y_lpf = y_lpf + alpha * ((float)raw - y_lpf);
    }

    Serial.print("A0:");
    Serial.print(raw);
    Serial.print(",LPF:");
    Serial.println(y_lpf, 2);
  }
}
CC      ?= gcc
CFLAGS  ?= -O2 -Wall -Wextra -std=c11 -fPIC
LDLIBS  = -lpthread

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
  LIB = liblinkpulse.dylib
  SHARED = -dynamiclib
else
  LIB = liblinkpulse.so
  SHARED = -shared
endif

.PHONY: all test clean

all: $(LIB)

$(LIB): linkpulse_engine.c linkpulse_engine.h
	$(CC) $(CFLAGS) $(SHARED) -o $@ linkpulse_engine.c $(LDLIBS)

test_engine: test_engine.c linkpulse_engine.c linkpulse_engine.h
	$(CC) $(CFLAGS) -o $@ test_engine.c linkpulse_engine.c $(LDLIBS)

test: test_engine
	./test_engine

clean:
	rm -f $(LIB) test_engine

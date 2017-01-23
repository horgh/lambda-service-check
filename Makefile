all: package.zip

clean:
	rm -rf build package.zip

package.zip: build lambda-service-check.js
	rm -f build/*
	cp lambda-service-check.js config.js build
	(cd build && zip -r ../package.zip .)

build:
	mkdir -p build

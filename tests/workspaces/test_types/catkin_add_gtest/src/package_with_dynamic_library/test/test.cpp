#include <gtest/gtest.h>
#include <library.h>

TEST(DynamicallyLinkedTest, RunTestCanBeCalled)
{
    test::Library tester;
    ASSERT_TRUE(tester.runTest());
}